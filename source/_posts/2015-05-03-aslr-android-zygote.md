---
layout:     post
title:      "The State of ASLR on Android Lollipop"
subtitle:   "Investigating the state of ASLR on Android, how Zygote breaks it, and how we fixed it in our ROM."
date:       2015-05-11 12:00:00
author:     "Daniel Micay"
header-img: "backgrounds/post7.jpg"
published:  true
---

Modern platforms like Android devices enforce execute protections on memory, so
injecting code into the process is often no longer the lowest hanging fruit for
exploitation. Reusing the existing code and data has become the norm, and
statistical defense via Address-Space Layout randomization is still the only
widely available countermeasure. Control Flow Integrity (CFI) techniques can be
used to protect against hijacking the return address and/or function pointers
(including those in virtual function tables) but still leaves data-only attacks
wide open and isn't fully ironed out. GCC, Android's default compiler, has no
implementation and the recently landed implementation in Clang/LLVM is very
limited. Since ASLR is pretty much the only game in town for the vast amounts
of code written in memory unsafe languages, the quality of implementation is a
very important aspect of a platform's security.

Identifying and addressing the weaknesses in Android's ASLR implementation is
one of the many steps taken by Copperhead's Android fork to harden the system.
Most of the relevant code is [already available on
GitHub](https://github.com/copperhead/) and the rest will be there in
the future.

## Linux kernel

The Linux kernel was the birth place of ASLR, as part of the out-of-tree PaX
patches. The techniques were pioneered there and a weaker implementation was
eventually adopted by the Linux kernel and other mainstream operating systems.
These days, ASLR is one of the least interesting components of PaX as there are
many other compelling features without the same adoption by other operating
systems.

ASLR on Linux (including PaX kernels) works by randomizing various base
addresses used to define the layout of the address space. Enabling full ASLR
relies on cooperation from userspace, since the executable needs to be position
independent (PIE) like a dynamic library in order to be relocated, which was
not historically true. Each instance of an executable will be given a
randomized address space layout at execution time. This is in contrast to
Windows where relocations (runtime rewrites) are used instead of position
independent code, and the operating system caches the randomized addresses of
executables and libraries to share the pages between instances.

The vanilla implementation is lower entropy than the one in PaX and lacks the
robust mitigation of brute force attacks provided by
[grsecurity](https://grsecurity.net/)'s (a superset of PaX, developed alongside
it) GRKERNSEC_BRUTE feature. Most Android devices are 32-bit, where
brute-forcing is *very* practical even without local code execution. The other
common approach to bypassing it relies on information leaks giving up part or
all of an address. There's often no information channel to the attacker, so
this isn't an option even if the code does have this kind of uninitialized read
or read overflow vulnerability.

## Brief history of ASLR on Android

Early Android versions only had stack randomization due to lack of kernel
support for ASLR on ARM. The 4.0 release introduced [mmap
randomization](https://git.kernel.org/cgit/linux/kernel/git/torvalds/linux.git/commit/?id=cc92c28b2d)
thanks to upstream progress. The kernel also gained support for ARM
[exec](https://git.kernel.org/cgit/linux/kernel/git/torvalds/linux.git/commit/?id=e4eab08d60)
and
[brk](https://git.kernel.org/cgit/linux/kernel/git/torvalds/linux.git/commit/?id=990cb8acf2)
randomization but Android still lacked userspace support. The 4.1 release
introduced support for full ASLR by enabling [heap (brk)
randomization](https://android.googlesource.com/platform%2Fbionic/+/dcbc3787bfb9a272a010f13ac149d546b4b741d8)
and adding linker support for
[self-relocation](https://android.googlesource.com/platform%2Fbionic/+/dcbc3787bfb9a272a010f13ac149d546b4b741d8)
and [Position Independent Executables
(PIE)](https://android.googlesource.com/platform%2Fbionic/+/6cdefd06c0386776405e4379af036722db5d60c0).

Lollipop is the latest step forwards, as [non-PIE executable
support](https://android.googlesource.com/platform/bionic/+/2aebf5429bb1241a3298b5b642d38f73124c2026)
was dropped and all processes now have full ASLR.

The [vDSO](http://man7.org/linux/man-pages/man7/vdso.7.html) has been
randomized since [it was introduced on 64-bit
ARM](https://git.kernel.org/cgit/linux/kernel/git/torvalds/linux.git/commit/?id=9031fefde6f2ac1d1e5e0f8f4b22db4a091229bb)
and from the beginning of x86 Android. It does not yet exist on 32-bit ARM.

At first glance, it appears to be ahead of most Linux distributions as only a
few like Alpine Linux and Hardened Gentoo use full ASLR (i.e. compiling/linking
as PIE) across the board. However, there are several problems unique to
Android.

## Zygote process spawning model

A traditional Unix-like system spawns processes by using `fork()` to duplicate
a process and then `exec(...)` to replace it with an executable image after the
environment (file descriptors, working directory, etc.) is set up as desired. A
forked process shares the same address space layout and the `exec(...)` call is
where ASLR determines a new layout (the set of bases).

Android doesn't use the traditional spawning model for applications and most of
the system services. Instead, a "zygote" service is spawned during early boot,
and is responsible for spawning nearly all processes that come after it. It
does this by using `fork()` and then loading process-specific code and data
*without* calling `exec(...)`. This spawning model is simply an optimization,
reducing both start-up time and memory usage.

The Zygote reduces memory usage thanks to the usage of copy-on-write across
processes, which is able to share data that would otherwise be duplicated like
the relocation sections that are rewritten based on where code ends up. In
fact, Android has infrastructure in the system server (the core service),
linker and elsewhere to support dynamically sharing relocation sections across
executables. This takes advantage of immediate binding and RELRO making the
relocation sections read-only at runtime. The WebView library has a 2M RELRO
section and is currently the only library that's handled this way, although the
infrastructure is generic. The Zygote also spends ~800ms (on a Nexus 5)
preloading over 3000 classes (most apps use ~80-250) and ~500ms preloading over
500 graphical resources (typically even sparser usage), various shared
libraries and an EGL (OpenGL) context in order to perform lots of work up-front
and then reuse it.

The consequence of zygote spawning model is that there are shared ASLR bases
across applications and most services. This defeats ASLR as a local security
mechanism between processes of different privilege levels and severely weakens
it against remote attackers. An information leak in one application gives away
the ASLR bases for all others and the bases remain constant across executions
rather than being randomized again after a process is restarted. This makes
brute forcing even more practical.

The simplest fix is to switch to the `fork()` + `exec(...)` spawning model with
no preloading. This increases memory usage by ~3M to ~15M depending on the
process. The start-up time is acceptable once preloading is disabled (~1.2s
wasted!), but there's a noticeable regression. This is currently the path taken
by Copperhead OS as it's simple and fast enough for the niche. A faster but
more complex approach is to use a pre-spawning pool as done in the [Morula
research paper](http://wenke.gtisc.gatech.edu/papers/morula.pdf). This does not
reduce memory usage but it does go a long way to fixing the start-up time
regression. It's likely going to be the approach for Copperhead OS in the
future and may even be acceptable upstream for high memory devices. The Morula
proof of concept code has some issues like file descriptor leaks and needs to
be ported to Lollipop. It's much less important now that ART has drastically
improved start-up time without the zygote.

The `/proc/$PID/maps` output for the vanilla phone service and calendar app
demonstrates the impact of the zygote spawning model. The stack, executable and
mmap bases are identical across both processes along with the base image file
and the garbage collected heap alongside it.

**com.android.phone on vanilla Android (5.0.1)**

~~~
12c00000-12e01000 rw-p 00000000 00:04 7599       /dev/ashmem/dalvik-main space (deleted)
12e01000-13745000 rw-p 00201000 00:04 7599       /dev/ashmem/dalvik-main space (deleted)
13745000-32c00000 ---p 00b45000 00:04 7599       /dev/ashmem/dalvik-main space (deleted)
32c00000-32c01000 rw-p 00000000 00:04 7600       /dev/ashmem/dalvik-main space (deleted)
32c01000-52c00000 ---p 00001000 00:04 7600       /dev/ashmem/dalvik-main space (deleted)
70724000-710d3000 rw-p 00000000 b3:19 253461     /data/dalvik-cache/arm/system@framework@boot.art
710d3000-72c5e000 r--p 00000000 b3:19 253460     /data/dalvik-cache/arm/system@framework@boot.oat
72c5e000-7425e000 r-xp 01b8b000 b3:19 253460     /data/dalvik-cache/arm/system@framework@boot.oat
7425e000-7425f000 rw-p 0318b000 b3:19 253460     /data/dalvik-cache/arm/system@framework@boot.oat
[...]
a2cad000-a3000000 r--s 00020000 b3:17 1752       /system/priv-app/TeleService/TeleService.apk
[...]
b6d71000-b6dd4000 r-xp 00000000 b3:17 1209       /system/lib/libc.so
b6dd4000-b6dd7000 r--p 00062000 b3:17 1209       /system/lib/libc.so
b6dd7000-b6dda000 rw-p 00065000 b3:17 1209       /system/lib/libc.so
[...]
b6ef4000-b6f01000 r-xp 00000000 b3:17 227        /system/bin/linker
b6f01000-b6f02000 r-xp 00000000 00:00 0          [sigpage]
b6f02000-b6f03000 r--p 0000d000 b3:17 227        /system/bin/linker
b6f03000-b6f04000 rw-p 0000e000 b3:17 227        /system/bin/linker
b6f04000-b6f05000 rw-p 00000000 00:00 0 
b6f05000-b6f08000 r-xp 00000000 b3:17 153        /system/bin/app_process32
b6f08000-b6f09000 r--p 00002000 b3:17 153        /system/bin/app_process32
b6f09000-b6f0a000 rw-p 00000000 00:00 0 
be615000-be615000 ---p 00000000 00:00 0 
be615000-bee14000 rw-p 00000000 00:00 0          [stack]
[...]
~~~

**com.android.calendar on vanilla Android (5.0.1)**

~~~
12c00000-12e01000 rw-p 00000000 00:04 7599       /dev/ashmem/dalvik-main space (deleted)
12e01000-13745000 rw-p 00201000 00:04 7599       /dev/ashmem/dalvik-main space (deleted)
13745000-32c00000 ---p 00b45000 00:04 7599       /dev/ashmem/dalvik-main space (deleted)
32c00000-32c01000 rw-p 00000000 00:04 7600       /dev/ashmem/dalvik-main space (deleted)
32c01000-52c00000 ---p 00001000 00:04 7600       /dev/ashmem/dalvik-main space (deleted)
70724000-710d3000 rw-p 00000000 b3:19 253461     /data/dalvik-cache/arm/system@framework@boot.art
710d3000-72c5e000 r--p 00000000 b3:19 253460     /data/dalvik-cache/arm/system@framework@boot.oat
72c5e000-7425e000 r-xp 01b8b000 b3:19 253460     /data/dalvik-cache/arm/system@framework@boot.oat
7425e000-7425f000 rw-p 0318b000 b3:19 253460     /data/dalvik-cache/arm/system@framework@boot.oat
[...]
b5025000-b502c000 r--s 0024f000 b3:17 32         /system/app/Calendar/Calendar.apk
[...]
b6d71000-b6dd4000 r-xp 00000000 b3:17 1209       /system/lib/libc.so
b6dd4000-b6dd7000 r--p 00062000 b3:17 1209       /system/lib/libc.so
b6dd7000-b6dda000 rw-p 00065000 b3:17 1209       /system/lib/libc.so
[...]
b6ef4000-b6f01000 r-xp 00000000 b3:17 227        /system/bin/linker
b6f01000-b6f02000 r-xp 00000000 00:00 0          [sigpage]
b6f02000-b6f03000 r--p 0000d000 b3:17 227        /system/bin/linker
b6f03000-b6f04000 rw-p 0000e000 b3:17 227        /system/bin/linker
b6f04000-b6f05000 rw-p 00000000 00:00 0 
b6f05000-b6f08000 r-xp 00000000 b3:17 153        /system/bin/app_process32
b6f08000-b6f09000 r--p 00002000 b3:17 153        /system/bin/app_process32
b6f09000-b6f0a000 rw-p 00000000 00:00 0 
be615000-be615000 ---p 00000000 00:00 0 
be615000-bee14000 rw-p 00000000 00:00 0          [stack]
[...]
~~~

The output from Copperhead OS is much different, as PaX ASLR is
different from vanilla and ignores mmap hints. The two applications have
distinct address spaces since an `exec(...)` spawning model is used.

**com.android.phone on CopperheadOS:**

~~~
02755000-02757000 r-xp 00000000 b3:19 155        /system/bin/app_process32
02757000-02758000 r--p 00002000 b3:19 155        /system/bin/app_process32
02758000-02759000 rw-p 00000000 00:00 0 
02759000-0389f000 ---p 00000000 00:00 0 
0389f000-038a0000 rw-p 00000000 00:00 0          [heap]
6f77f000-702e3000 rw-p 00000000 b3:1c 105877     /data/dalvik-cache/arm/system@framework@boot.art
702e3000-71e7e000 r--p 00000000 b3:1c 105876     /data/dalvik-cache/arm/system@framework@boot.oat
71e7e000-733f9000 r-xp 01b9b000 b3:1c 105876     /data/dalvik-cache/arm/system@framework@boot.oat
733f9000-733fa000 rw-p 03116000 b3:1c 105876     /data/dalvik-cache/arm/system@framework@boot.oat
733fa000-73d03000 rw-p 00000000 00:04 11159      /dev/ashmem/dalvik-main space (deleted)
73d03000-73dfb000 ---p 00909000 00:04 11159      /dev/ashmem/dalvik-main space (deleted)
73dfb000-933fa000 ---p 00a01000 00:04 11159      /dev/ashmem/dalvik-main space (deleted)
[...]
a89e5000-a89f1000 r--s 003e8000 b3:19 1494       /system/priv-app/TeleService/TeleService.apk
[...]
af5d8000-af629000 r-xp 00000000 b3:19 945        /system/lib/libc.so
af629000-af62b000 r--p 00051000 b3:19 945        /system/lib/libc.so
af62b000-af62e000 rw-p 00053000 b3:19 945        /system/lib/libc.so
[...]
af642000-af64f000 r-xp 00000000 b3:19 232        /system/bin/linker
af64f000-af650000 r--p 0000c000 b3:19 232        /system/bin/linker
af650000-af651000 rw-p 0000d000 b3:19 232        /system/bin/linker
af651000-af652000 rw-p 00000000 00:00 0 
bc1db000-bc1dc000 ---p 00000000 00:00 0 
bc1dc000-bc9db000 rw-p 00000000 00:00 0          [stack]
[...]
~~~

**com.android.calendar on CopperheadOS:**

~~~
0fe32000-0fe34000 r-xp 00000000 b3:19 155        /system/bin/app_process32
0fe34000-0fe35000 r--p 00002000 b3:19 155        /system/bin/app_process32
0fe35000-0fe36000 rw-p 00000000 00:00 0 
0fe36000-10c2a000 ---p 00000000 00:00 0 
10c2a000-10c2b000 rw-p 00000000 00:00 0          [heap]
6f77f000-702e3000 rw-p 00000000 b3:1c 105877     /data/dalvik-cache/arm/system@framework@boot.art
702e3000-71e7e000 r--p 00000000 b3:1c 105876     /data/dalvik-cache/arm/system@framework@boot.oat
71e7e000-733f9000 r-xp 01b9b000 b3:1c 105876     /data/dalvik-cache/arm/system@framework@boot.oat
733f9000-733fa000 rw-p 03116000 b3:1c 105876     /data/dalvik-cache/arm/system@framework@boot.oat
733fa000-739fb000 rw-p 00000000 00:04 327533     /dev/ashmem/dalvik-main space (deleted)
739fb000-933fa000 ---p 00601000 00:04 327533     /dev/ashmem/dalvik-main space (deleted)
[...]
9d9fe000-9da06000 r--s 0024c000 b3:19 33         /system/app/Calendar/Calendar.apk
[...]
a45c8000-a4619000 r-xp 00000000 b3:19 945        /system/lib/libc.so
a4619000-a461b000 r--p 00051000 b3:19 945        /system/lib/libc.so
a461b000-a461e000 rw-p 00053000 b3:19 945        /system/lib/libc.so
[...]
a4632000-a463f000 r-xp 00000000 b3:19 232        /system/bin/linker
a463f000-a4640000 r--p 0000c000 b3:19 232        /system/bin/linker
a4640000-a4641000 rw-p 0000d000 b3:19 232        /system/bin/linker
[...]
a4641000-a4642000 rw-p 00000000 00:00 0 
b5384000-b5385000 ---p 00000000 00:00 0 
b5385000-b5b84000 rw-p 00000000 00:00 0          [stack]
[...]
~~~

## Android Runtime (ART)

ART moved Android to generating specialized native code from bytecode upon
installation rather than using a just-in-time compiler to do it at runtime.
This is a significant security improvement because writable executable memory
is now mostly restricted to applications making use of the Chromium-based
WebView widget. The generated code is mapped from storage into the address
space of the process spawned from the Zygote rather than a traditional model
where `exec` is called on an executable.

The generated code has a hard-wired base address just like native binaries, and
is always relocated by default on a production Android system. Since this
occurs in userspace, the Android Runtime code is responsible for choosing an
address. The main base image is currently chosen by applying a delta generated
with the following code to the base address:

~~~ cpp
std::default_random_engine generator;
generator.seed(NanoTime() * getpid());
std::uniform_int_distribution<int32_t> distribution(min_delta, max_delta);
~~~

The main garbage collected heap is then placed directly next to it.

It would be far saner if the generated value came from a cryptographically
secure source of entropy like Bionic's arc4random() implementation. The default
range of deltas also only picks an offset within 16MiB in either direction,
even on 64-bit. With typical 4096 byte pages, there are only 4096 possible
bases (12-bit entropy). The mapping includes everything an attacker needs to
take control of the process so it weakens the overall effectiveness of ASLR.

With PaX ASLR, the usual mmap base is used because mmap hints are ignored. As
is the case here, this is usually a good thing for security. There isn't a
compelling reason to map read-only code anywhere but the kernel's chosen
location because there are already dynamic libraries there.

## System allocator

Dynamic allocations in the Android userspace are performed via allocators
implemented on top of the kernel memory mapping APIs: the legacy brk system
call for expanding or shrinking the data section (dss) and the more modern
mmap, mremap and munmap calls. It's not safe to have concurrent users of brk,
so it is typically used only in the standard C library's `malloc`
implementation if it is used at all.

The kernel chooses random base addresses for brk and mmap but allocator design
in userspace can significantly reduce the available entropy. It's possible to
improve upon the randomization offered by the kernel by using isolated heaps
with different random bases or fine-grained randomization but it's difficult to
do this in a disciplined way where there are tangible security benefits. The
most important thing is simply preserving the security offered by the kernel.

Up until Lollipop, the allocator in Android's standard C library implementation
(Bionic) was good old [dlmalloc](http://g.oswego.edu/dl/html/malloc.html). It's
a decent general purpose allocator despite the age and the memory space API for
managing isolated heaps was used to implement Dalvik's non-compacting garbage
collector on top of a contiguous memory mapping.

The dlmalloc allocator doesn't perform any randomization itself but it also
doesn't degrade the entropy offered by the kernel. The main memory space uses
brk until it's exhausted for allocations below the mmap threshold so there's
some isolation from mmap allocations. It also benefits from intra-page brk
randomization by the kernel, although that's not available in vanilla Android
as it's a feature still limited to PaX kernels.

In Lollipop, Android moved to a compacting garbage collector as part of
replacing Dalvik with the new Android Runtime (ART) but still uses dlmalloc to
implement a separate garbage collected heap for the remaining non-movable
objects. The malloc implementation in Bionic was replaced with jemalloc for
improved performance and scalability along with with lower fragmentation and
lazy purging of unused page spans.

Unlike dlmalloc, jemalloc does reduce heap randomization entropy. It's a side
effect of the low-level chunk allocation model, where all memory is allocated
via naturally aligned chunks of the same size. The jemalloc version used in the
current release of Lollipop uses 4MiB chunks (4MiB aligned) while the upcoming
release will use 256kiB chunks (256kiB aligned) due to changes in the upstream
jemalloc design (for reasons unrelated to ASLR). With 4MiB chunks, it loses 10
bits of ASLR entropy relative to 4k page granularity (2^12 -> 2^22) while the
new default chunk size causes a less severe 6-bit loss of entropy.

The randheap2 test from the paxtest suite can be used to confirm this. The
following output is with a vanilla kernel on x86_64, but the number of bits
lost is the same across architectures:

~~~
% /usr/lib/paxtest/randheap2
Heap randomisation test (PIE)            : 28 quality bits (guessed)
% LD_PRELOAD=/usr/lib/libjemalloc.so /usr/lib/paxtest/randheap2
Heap randomisation test (PIE)            : 18 quality bits (guessed)
% LD_PRELOAD=/usr/lib/libjemalloc.so MALLOC_CONF=lg_chunk:22 /usr/lib/paxtest/randheap2
Heap randomisation test (PIE)            : 18 quality bits (guessed)
% LD_PRELOAD=/usr/lib/libjemalloc.so MALLOC_CONF=lg_chunk:18 /usr/lib/paxtest/randheap2
Heap randomisation test (PIE)            : 22 quality bits (guessed)
~~~

The rationale for the chunk allocation design in jemalloc is very compelling so
it's unlikely that this will be changed. Allocations smaller than the chunk
size are stored within chunks after the chunk's metadata header and huge
allocations are spans of chunks. This allows identifying allocations smaller
than the chunk size from the fact that they're not chunk aligned and the
metadata can be found in O(1) time in the header. It's also the basis for a
chunk recycling scheme allowing jemalloc to avoid the overhead and lack of
scalability of mapping and unmapping memory by recycling spans of chunks itself
and doing lazy page purging rather than ever unmapping memory. It also has
better worst-case time complexity than the kernel (logarithmic, not linear) and
greatly reduced address space fragmentation.

Another difference between jemalloc and traditional allocators like dlmalloc is
that it doesn't have much use for brk. It only allocates chunks from the
operating system and handles recycling non-contiguous spans in O(log n) time
already. It defaults to using mmap and then brk but can be configured to use
brk and then mmap, which would offer some isolation from mmap allocations such
as writable executable memory from a JIT compiler. There aren't currently any
performance differences between the two options, especially since it's only
used to expand the peak virtual memory. However, mmap will likely have
performance advantages in the future if it becomes possible to move pages
between mappings with `mremap` as a `realloc` optimization.

Copperhead OS is currently using a port of OpenBSD's memory allocator, which is
zone-based like jemalloc but with page-size zones (no loss of entropy) and a
bit of fine-grained randomization for small allocations and zone caching. It
would be unacceptable for vanilla Android because it has a global lock like
dlmalloc and is slower and more prone to fragmentation then dlmalloc for
allocations larger than the page size. It's more than good enough for a
hardened OS, but not one targeted at running performance-critical code like
games or professional audio applications.

There are many other security-relevant aspects to the system allocator(s) and
future posts will delve much deeper into this.

## PaX ASLR (and more) on Android

PaX works very well out-of-the-box on Android, with no need for exceptions from
PaX ASLR for the base system. All of the kernel hardening features work fine
with some minor adjustments for out-of-tree code, and there are fewer problems
with the userspace features than there are with typical desktop systems. A few
broken third party applications like Firefox require a RANDMMAP exception. Some
MPROTECT exceptions are needed to allow runtime code generation, as would be
expected. ART itself doesn't require this and even Dalvik didn't *need* it
because it would happily fall back to interpretation, so many Android
applications work fine with MPROTECT enabled.

PaX's executable exception system is too coarse in Android's executation model.
Most Android applications run as `/system/bin/app_process` even if the standard
fork model is used and changing this is unrealistic. A solid alternative would
be gid-based exceptions, since that's the basis of Android's permission model.
It may be possible to implement this via PaX's hooks from a module rather than
actually adding a core feature. Copperhead OS currently [applies the exceptions
to executables via extended
attributes](https://github.com/copperhead/android_build/commit/e4ae9f7de1ba39f4a55132df63c28ab4e3f72ffb)
but will likely move to an Android-specific system.

Android currently has two actively maintained kernel branches: 3.4 kernels for
most current devices, and 3.10 for some recent devices and most upcoming ones.
Sadly, this doesn't match up with either of the PaX/grsecurity LTS branches:
3.2 and 3.14. Copperhead OS is currently targeting a 3.4 kernel (for the Nexus
5 and Samsung S4) with many bug fixes ported from the 3.2 LTS. The move to 3.10
will hopefully happen within a year or two when more devices are available,
with backports from the 3.14 LTS. Maintaining a proper port is a lot of work
with a lot of room for mistakes, so collaboration with other interested parties
would be ideal.

## Conclusion

Android has done a great job adopting standard Linux security technologies like
full ASLR. It is comparable to hardened distributions like Alpine Linux and
Hardened Gentoo in that sense but it doesn't make the same improvements over
the mediocre status quo by incorporating features from PaX/grsecurity. The
atypical design of Android platform has also introduced weaknesses that aren't
present in traditional distributions, and addressing some of them means
reversing performance and memory usage optimizations to some extent.
