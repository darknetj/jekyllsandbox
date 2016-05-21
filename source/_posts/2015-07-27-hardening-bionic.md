---
layout:     post
title:      "Hardening Android's Bionic libc"
subtitle:   "Extending the exploit mitigations in Android's standard C library
implementation"
date:       2015-07-27 12:00:00
author:     "Daniel Micay"
header-img: "backgrounds/code.png"
header-pos: "top center"
published:  true
---

This article provides an overview of the security improvements implemented in
the CopperheadOS libc. The improvements are available in [Copperhead's Bionic
repository on GitHub](https://github.com/copperhead/android_bionic/)
and a subset of the work has been submitted upstream. The intention is to
upstream as much as possible. However, CopperheadOS fills a different niche
than vanilla Android so it can make sacrifices to performance, memory usage and
compatibility that aren't suitable in the upstream project.

All of the CopperheadOS repositories are now public on GitHub and an alpha
release with pre-built ROMs for the Nexus 5 and Samsung Galaxy S4 will happen
in the near future. Build instructions will also be posted soon.

## `_FORTIFY_SOURCE`

The `_FORTIFY_SOURCE` feature provides inline wrappers for C standard library
functions designed to catch common classes of vulnerabilities before they can
be exploited. It's primarily used to catch buffer overflows via the
`__builtin_object_size` intrinsic, although it can catch other issues. Buffer
overflows are still one of the most common classes of vulnerabilities in
Android because there's a lot of C and C++ code underlying the memory safe
Java. C standard library functions like `memcpy` tend to be a major source of
these issues as they're widely used. Programs using homegrown functions need to
be migrated over to standard ones to take advantage of this feature.

Android uses `_FORTIFY_SOURCE=2` internally, but it's not yet used by the NDK
because it needs to provide forwards compatibility there. It needs to be tied to
the `__ANDROID_API__` define, with fortified functions only being used if they
are available across the API levels supported by the application.

The `__builtin_object_size(ptr, type)` intrinsic returns the size of the object
`ptr` points at, which can be used to implement buffer overflow checks. With
`type` set to `0` or `1`, it will return the maximum possible size (`SIZE_MAX`
if unknown), while `2` and `3` provide the minimum (0 if unknown). The `2` and
`3` values are not used by `_FORTIFY_SOURCE` because it would cause many false
positives.

The `0` and `2` types include all surrounding objects, while `1` and `3` return
only the set of the subobject. `_FORTIFY_SOURCE=1` uses `0` for compliance with
the C standards, while `_FORTIFY_SOURCE=2` uses `1` for many functions to catch
more vulnerabilities at the expense of having some rare false positives. There
are still functions where `0` is used (the `memcpy` and `read` families) so
there could be a `_FORTIFY_SOURCE=3` option in the future.

This example demonstrates the distinction between `_FORTIFY_SOURCE=1` and
`_FORTIFY_SOURCE=2`:

~~~ c
#include <stdio.h>

struct blob {
    char buf[64];
    char buf2[64];
    char buf3[64];
};

int main(void) {
    struct blob b;
    printf("%zu\n", __builtin_object_size(b.buf2, 0));
    printf("%zu\n", __builtin_object_size(b.buf2, 1));
    return 0;
}
~~~

Output:

~~~
128
64
~~~

CopperheadOS has added fortified implementations of the following functions,
with more to come:

* fread (upstreamed)
* fwrite (upstreamed)
* getcwd (submitted upstream)
* memchr (upstreamed)
* memrchr (upstreamed)
* pread (upstreamed)
* pread64 (upstreamed)
* pwrite
* pwrite64
* readlink (upstreamed)
* readlinkat (upstreamed)
* realpath (upstreamed)
* write

### Examples

A simple example is the POSIX `read` function:

~~~ c
ssize_t read(int fd, void *buf, size_t count);
~~~

A `count` higher than the size of the buffer will (usually) lead to a buffer
overflow. When the buffer size can be determined at compile-time by the
compiler, `_FORTIFY_SOURCE` can catch any overflows.

If the compiler can statically determine the `count` value, the error will be
produced at compile-time:

~~~ c
#include <fcntl.h>
#include <unistd.h>

int main(void) {
    char buf[1];
    int fd = open("/dev/zero", O_RDONLY);
    if (fd == -1)
        return 1;
    read(fd, buf, 2);
    return 0;
}
~~~

Output:

~~~
error: call to `__read_count_toobig_error` declared with attribute error: read called with size bigger than destination
~~~

If `count` cannot be determined at compile-time, a call will be made to
`__read_chk` instead of `read` and the overflow will be caught at runtime. The
`atoi` call here isn't *currently* constant folded so it's a simple way of
emulating a value only known at runtime value for these examples:

~~~ c
#include <fcntl.h>
#include <unistd.h>
#include <stdlib.h>

int main(void) {
    char buf[1];
    int fd = open("/dev/zero", O_RDONLY);
    if (fd == -1)
        return 1;
    read(fd, buf, atoi("2") /* runtime value */);
    return 0;
}
~~~

Output:

~~~
read: prevented write past end of buffer
~~~

Unlike glibc, Bionic also tries to catch reads past the end of a buffer, rather
than just writes:

~~~ c
#include <fcntl.h>
#include <unistd.h>
#include <stdlib.h>

int main(void) {
    char buf[1] = {0};
    int fd = open("/dev/zero", O_RDONLY);
    if (fd == -1)
        return 1;
    write(fd, buf, atoi("2") /* runtime value */);
    return 0;
}
~~~

Output:

~~~
write: prevented read past end of buffer
~~~

### Dynamic memory allocations

The `alloc_size` function attribute can be used to annotate functions returning
dynamic memory allocations with the size determined by one (malloc, realloc,
etc.) or two (calloc, reallocarray, etc.) function parameters.

~~~ c
#include <fcntl.h>
#include <unistd.h>
#include <stdlib.h>

int main(void) {
    char *buf = calloc(1, 1);
    int fd = open("/dev/zero", O_RDONLY);
    if (fd == -1)
        return 1;
    write(fd, buf, atoi("2") /* runtime value */);
    return 0;
}
~~~

Output:

~~~
write: prevented read past end of buffer
~~~

The main C standard library allocation functions are already covered, but there
are many functions throughout Android's large codebase where this can be added.
For example, Android still makes use of dlmalloc's mspace API to implement the
Android Runtime's (ART) alternate non-moving GC heap so it's marked with the
`alloc_size` attribute by CopperheadOS.

### Link-time optimization

`_FORTIFY_SOURCE` is *highly* dependent on compiler optimizations, so it
becomes a lot more powerful when the compiler is given much more freedom to
optimize. Link-time optimization eliminates the optimization barrier between
compilation units in C, causing many more overflows to be caught.

The `write` example from above can be split up into two files to demonstrate
this. Even trivial examples like this are especially common in real-world
programs written to be portable across architectures like OpenSSL.

First:

~~~ c
#include <unistd.h>

ssize_t write_wrapper(int fd, const void *buf, size_t count) {
    return write(fd, buf, count);
}
~~~

Second:

~~~ c

#include <fcntl.h>
#include <stdlib.h>

ssize_t write_wrapper(int, void *, size_t);

int main(void) {
    char buf[1] = {0};
    int fd = open("/dev/zero", O_RDONLY);
    if (fd == -1)
        return 1;
    write_wrapper(fd, buf, atoi("2") /* runtime value */);
    return 0;
}
~~~

The size of `buf` in `write_wrapper` is never known, so the `write` call is
just compiled down to a regular unprotected call to `write`. However, compiling
these files with `-flto` allows `write_wrapper` to be inlined and the buffer
overflow can be detected again:

~~~
write: prevented read past end of buffer
~~~

CopperheadOS will be moving towards widespread use of link-time optimization to
greatly improve features like `_FORTIFY_SOURCE`. It's also a hard requirement
for Clang's work-in-progress [Control Flow
Integrity](http://clang.llvm.org/docs/ControlFlowIntegrity.html) support.

### Compiler deficiencies

`_FORTIFY_SOURCE` is a great feature, but it's held back by some compiler
deficiencies. For example, there's no `__builtin_runtime_object_size` to return
sizes that aren't necessarily constant for the runtime `__foo_chk` calls. This
would allow catching overflows for buffers with dynamic sizes. For example,
it would print `32` here rather than having to report the size as unknown:

~~~ c
#include <stdio.h>
#include <stdlib.h>

int main(void) {
    char *p = malloc(atoi("32") /* runtime value */);
    if (!p)
        return 1;
    printf("%zu\n", __builtin_object_size(p, 0));
    return 0;
}
~~~

GCC has intrinsics for various fortified functions that are able to provide
higher performance and can potentially catch more issues. However, they're
based on glibc's implementation and miss checking for read overflows. This is
somewhat problematic for Bionic.

#### Clang-specific issues

Clang doesn't play well with `_FORTIFY_SOURCE`, because it has poor or missing
implementations of the GNU C features that are involved.

The `__builtin_object_size` intrinsic is supposed to report NULL pointers as
having an unknown size, and Clang implements it properly in the frontend's
constant folding. However, null pointers are [reported as having a 0 byte size
by LLVM](https://llvm.org/bugs/show_bug.cgi?id=23277) and that's always the
path used to handle it for `_FORTIFY_SOURCE` since Clang doesn't do inlining in
the frontend. This is very problematic for functions like `getcwd` where null
pointers are permitted.

Clang [completely ignores fortified functions using the GNU C alias
idiom](https://llvm.org/bugs/show_bug.cgi?id=10276) used to call through to the
unchecked function in fast paths where overflow can be ruled out at
compile-time. This causes it to ignore 95% of the functions in glibc, and
Bionic has to work around it with ifdefs.

There are also problems stemming from the clean separation between Clang and
LLVM. For example, it provides no error/warning function attributes so it can't
catch issues at compile-time. This also has to be worked around with ifdefs in
Bionic.

The `__builtin_constant_p` intrinsic used to make compile-time fast paths or
checks via the error/warning attributes is also problematic. Clang folds it in
the frontend (i.e. before inlining and other optimizations) so it will always
be 0 in the fortified functions.

Clang lowers `__builtin_object_size` to an LLVM intrinsic and it [doesn't
provide the stricter semantics](https://llvm.org/bugs/show_bug.cgi?id=15212)
for `_FORTIFY_SOURCE=2`. The information needed to do that is lost during the
conversion from the C AST to LLVM IR.

The intrinsics used to handle varargs functions in glibc's `_FORTIFY_SOURCE`
implementation are also missing. This hasn't been an issue in Bionic yet,
because there are specialized intrinsics for most of the varargs functions now
and Clang does provide those.

Clang is also missing an implementation of the `alloc_size` attribute.

## Function pointers

Writable function pointers are low-hanging fruit for hijacking control flow
with an overflow from a nearby buffer or an arbitrary write vulnerability.
CopperheadOS eliminates the remaining cases from libc to provide a good
baseline. However, these are widespread in other libraries and applications.
C++ and Java (ART) would require compiler mitigations to protect virtual
function tables.

### RELRO

Android linker's already implements a RELRO section for making data read-only
after relocations are applied. Among other things, this protects the function
pointers in the PLT/GOT. It also makes constants truly read-only even if they
depend on the value of 'constant' addresses that are determined by the linker
during initialization. Android enables the RELRO section and disables lazy
linking for all code by default.

### Callback registration functions

The standard C library contains a few functions for registering callbacks, and
these function pointers can potentially be hijacked by an attacker. Much of
Bionic's code is taken directly from OpenBSD's libc, including the atexit
implementation. It puts the handler data in dedicated read-only pages that are
only made writable when new handlers are being registered via `atexit`.

CopperheadOS extends this memory protection feature to the FreeBSD
`at_quick_exit` implementation used in Bionic along with the native
`pthread_atfork` implementation.

### vDSO function pointers

The Linux kernel provides a virtual shared object called the vDSO. This is used
to provide blazing fast implementations of functions like `gettimeofday`,
`clock_gettime` and `sched_getcpu` without making a system call. In glibc, the
vDSO is handled by the dynamic linker so static executables are stuck with slow
implementations of these functions. Bionic deals with it by making the calls
through a function pointer table, which starts off pointing at the system call
wrappers but is then modified to point to the vDSO at runtime. This has the
benefit of working in static executables, but it opens up the same hole that's
closed by RELRO.

CopperheadOS makes this function pointer table read-only at runtime, and this
improvement was recently upstreamed.

## OpenBSD malloc

CopperheadOS replaces jemalloc with a port of OpenBSD's hardened allocator. It
currently uses the same default configuration for it as OpenBSD.

Lots of the global malloc data is made read-only after initialization, and the
main global data area is placed at a random offset between two guard pages. A
global hash table is used to avoid inline metadata alongside allocations.

By default, it junk fills small allocations upon free and the initial portion
of large ones (half a page). This eliminates most information leaks from
allocations that are used uninitialized and mitigates some use-after-free
vulnerabilities.

Fine-grained randomization is done at both the page cache layer and for small
allocations. This can make use-after-free and heap overflow vulnerabilities
significantly harder to exploit, along with reducing the utility of address
leaks. There's a lot of room for improvement here. For one thing, it relies on
OpenBSD's fine-grained mmap randomization. CopperheadOS will likely extend it
with randomly sized `PROT_NONE` gaps around the global malloc data to work
around this.

There's also support for adding guard pages to large allocations and sliding
allocations to the end of the page to increase the likelihood of hitting these
(or an unmapped gap, with guard pages disabled). This is disabled by default
because it adds makes allocations larger than the page size significantly
slower.

Android used dlmalloc until it switched to jemalloc with 5.0 (Lollipop) and the
OpenBSD allocator fares pretty well in a performance comparison against it. It
isn't at all competitive with jemalloc, which has nearly linear scalability
rather than global locking, much better single-threaded performance (thread
caches amortize the cost of locking, etc.) and very low virtual memory
fragmentation. This makes it unsuitable for inclusion upstream, but it's a
perfect fit for CopperheadOS. Garbage collection performance is a lot more
important to most Android applications, and code avoiding Java for performance
reasons is going to avoid malloc.

## Stack smashing protection

Stack smashing protection (SSP) is a compiler feature for catching buffer
overflows on the stack at runtime. The compiler inserts a random canary on the
stack just after pushing the return pointer and then validates it when the
function returns. This can prevent exploitation of a subset of buffer overflow
vulnerabilities, and forces the attacker to find a second vulnerability in
some other cases.

Bionic is fairly unique in that it supports hardening libc itself with SSP. It
explicitly compiles the subset of code where SSP won't work with
-fno-stack-protector. This includes the SSP checking code itself along with the
initialization code (like the entire linker) running before TLS and the stack
guard value are set up. It would be a lot cleaner if GCC and Clang supported a
`no_stack_protect` attribute to go along with `stack_protect`.

CopperheadOS includes an additional fix for compiling Bionic with
-fstack-protector-strong and it has been submitted upstream. It's the main
(possibly only) blocker for using this across Android's base system.
Copperhead's patch for using it in the NDK was already accepted.

The problem occurs in the early init code, where a stack address is taken and
then passed to various functions:

~~~ cpp
static pthread_internal_t main_thread;
main_thread.tls = tls;

// Tell the kernel to clear our tid field when we exit, so we're like any other pthread.
// As a side-effect, this tells us our pid (which is the same as the main thread's tid).
main_thread.tid = __set_tid_address(&main_thread.tid);
main_thread.set_cached_pid(main_thread.tid);
~~~

The -fstack-protector-strong feature protects *all* functions where overflows
are feasible so usage of arrays or stack references will trigger protection.

## Isolating libraries from the rest of the mmap heap

Linux ASLR isolates brk heap, mmap heap and main thread stack from each other.
PaX also isolates the executable image. Leaking the address of a global
variable will give away the position of executable code, but leaking an address
on the brk heap or main thread stack will not. However, the linker and dynamic
libraries are mapped with mmap, so executable code can be found reliably if any
mmap address is leaked. This also applies to malloc allocations backed with
mmap, which means all of them with jemalloc and the OpenBSD malloc, although
OpenBSD's malloc does make this a lot harder via fine-grained randomization.

CopperheadOS inserts a random gap after all of the initial libraries are loaded
to isolate them from the rest of the mmap heap. This provides 8-bit entropy on
32-bit archs with 4096 byte pages (1MiB gap) and more on 64-bit (1GiB gap). It
becomes less useful when a process makes executable memory mappings after the
initialization phase, and global C++ constructors can also make it less useful
if they allocate during initialization. It does work well for most standalone C
and C++ processes, just not the Android Runtime (ART).

It's easy to see in the `/proc/$PID/maps` output thanks to Android's VMA
naming ("init random gap"):

~~~
shell@hammerhead:/ $ busybox cat /proc/self/maps
0093e000-009cc000 r-xp 00000000 b3:19 1848       /system/xbin/busybox
009cc000-009ce000 r--p 0008d000 b3:19 1848       /system/xbin/busybox
009ce000-009cf000 rw-p 0008f000 b3:19 1848       /system/xbin/busybox
009cf000-009d1000 rw-p 00000000 00:00 0 
009d1000-03f35000 ---p 00000000 00:00 0 
03f35000-03f36000 rw-p 00000000 00:00 0          [heap]
a93b8000-a93b9000 r--p 00000000 00:00 0          [anon:atexit handlers]
a93b9000-a93bc000 rw-p 00000000 00:00 0 
a93bc000-a93bd000 ---p 00000000 00:00 0          [anon:malloc dir_info guard page]
a93bd000-a93be000 rw-p 00000000 00:00 0          [anon:malloc dir_info]
a93be000-a93bf000 ---p 00000000 00:00 0          [anon:malloc dir_info guard page]
a93bf000-a93ee000 ---p 00000000 00:00 0          [anon:init random gap]
a93ee000-a93ef000 r--p 00000000 00:00 0          [anon:pthread_atfork handlers]
a93ef000-a93f0000 rw-p 00000000 00:00 0 
a93f0000-a93f2000 r-xp 00000000 b3:19 1092       /system/lib/libnetd_client.so
a93f2000-a93f3000 r--p 00001000 b3:19 1092       /system/lib/libnetd_client.so
a93f3000-a93f4000 rw-p 00002000 b3:19 1092       /system/lib/libnetd_client.so
a93f4000-a9414000 r--s 00000000 00:0b 5636       /dev/__properties__
a9414000-a9419000 r-xp 00000000 b3:19 1064       /system/lib/liblog.so
a9419000-a941a000 r--p 00004000 b3:19 1064       /system/lib/liblog.so
a941a000-a941b000 rw-p 00005000 b3:19 1064       /system/lib/liblog.so
a941b000-a941c000 rw-p 00000000 00:00 0 
a941c000-a941e000 r-xp 00000000 b3:19 1173       /system/lib/libstdc++.so
a941e000-a941f000 r--p 00001000 b3:19 1173       /system/lib/libstdc++.so
a941f000-a9420000 rw-p 00002000 b3:19 1173       /system/lib/libstdc++.so
a9420000-a9436000 r-xp 00000000 b3:19 1066       /system/lib/libm.so
a9436000-a9437000 r--p 00015000 b3:19 1066       /system/lib/libm.so
a9437000-a9438000 rw-p 00016000 b3:19 1066       /system/lib/libm.so
a9438000-a9443000 r-xp 00000000 b3:19 1001       /system/lib/libcutils.so
a9443000-a9444000 r--p 0000a000 b3:19 1001       /system/lib/libcutils.so
a9444000-a9445000 rw-p 0000b000 b3:19 1001       /system/lib/libcutils.so
a9445000-a9497000 r-xp 00000000 b3:19 980        /system/lib/libc.so
a9497000-a9499000 r--p 00052000 b3:19 980        /system/lib/libc.so
a9499000-a949c000 rw-p 00054000 b3:19 980        /system/lib/libc.so
a949c000-a949f000 rw-p 00000000 00:00 0 
a949f000-a94a0000 r--p 00000000 00:00 0 
a94a0000-a94a7000 rw-p 00000000 00:00 0 
a94a7000-a94a8000 r--p 00000000 00:00 0          [anon:linker_alloc]
a94a8000-a94a9000 rw-p 00000000 00:00 0          [anon:linker_alloc]
a94a9000-a94aa000 r--p 00000000 00:00 0          [anon:linker_alloc]
a94aa000-a94ab000 r--p 00000000 00:00 0          [anon:atexit handlers]
a94ab000-a94ac000 ---p 00000000 00:00 0 
a94ac000-a94ae000 rw-p 00000000 00:00 0 
a94ae000-a94bc000 r-xp 00000000 b3:19 234        /system/bin/linker
a94bc000-a94bd000 r--p 0000d000 b3:19 234        /system/bin/linker
a94bd000-a94be000 rw-p 0000e000 b3:19 234        /system/bin/linker
a94be000-a94bf000 rw-p 00000000 00:00 0 
bc5db000-bc5fc000 rw-p 00000000 00:00 0          [stack]
ffff0000-ffff1000 r-xp 00000000 00:00 0          [vectors]
~~~

## ASLR for secondary stacks

Stack overflows caused by `alloca`, variable length arrays or large stack
frames can be used to overshoot the guard page placed at the bottom of thread
stacks by default. The -fstack-check feature prevents this by inserting writes
to guarantee that the guard page will be hit, but it's not implemented in Clang
and GCC's ARM implementation is buggy. Leaks of secondary stack addresses also
give away the location of other mmap mappings to an attacker.

The `write_at_address` primitive here has no undefined behavior, and the issue
is only caught with a non-default, non-portable compiler switch (ASAN sometimes
catches it too, but not always):

~~~ c
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static void write_at_address(void *target) {
    char var;

    // create a large enough array to hit the target
    char array[(uintptr_t)&var - (uintptr_t)target];

    // 32 is the magic number for gcc 5.2.0 with -O0 on x86_64
    size_t index = 64;

    if (sizeof(array) <= index)
        exit(1);

    ((char volatile *)array)[index] = 'X';
}

int main(void) {
    int size = 100;
    char *alloc = malloc(size);
    if (!alloc)
        return 1;
    memset(alloc, '.', size);

    printf("%.*s\n", size, alloc);
    write_at_address(alloc);
    printf("%.*s\n", size, alloc);

    return 0;
}
~~~

In grsecurity, there's a `RAND_THREADSTACK` feature to mitigate this via random
gaps with 8-bit entropy. It relies on the `MAP_STACK` flag being set for
secondary stacks, which isn't done by Bionic. CopperheadOS currently only uses
the PaX subset of grsecurity, but it implements a similar feature in Bionic as
it's more feasible to upstream that. It will send a SIGSEGV signal when it's
hit so it's not quite the same.

An advantage of doing this in userspace is the ability to provide a secondary
form of randomization, by choosing a random base for the stack within the first
page. This provides an extra 8 bits of entropy with 4096 byte pages and 16 byte
stack alignment. It also provides [cache
coloring](http://www.cs.technion.ac.il/~mad/publications/ismm2011-CIF.pdf),
reducing cache misses when threads use similar data layouts. It doesn't make
stack address leaks less useful but it does make most overflows from or into
the stack unreliable.

This feature has been submitted upstream, and I expect that it will be merged.
It is currently quite conservative on 32-bit where virtual memory isn't an
abundant resource.

Sample program:

~~~ c
#include <pthread.h>
#include <stdio.h>

void *print_base(void *data) {
    char stack_value;
    printf("%p\n", &stack_value);
    return data;
}

int main(void) {
    pthread_t thread;
    for (unsigned i = 0; i < 10; i++) {
        if (pthread_create(&thread, NULL, print_base, NULL)) {
            return 1;
        }
        if (pthread_join(thread, NULL)) {
            return 1;
        }
    }
    return 0;
}
~~~

Output (on 32-bit):

~~~
0xaa890d8f
0xaa88beaf
0xaa88d83f
0xaa88a07f
0xaa8872ef
0xaa88593f
0xaa881b0f
0xaa88fc9f
0xaa88726f
0xaa885b5f
~~~

## Signal stack guard pages

Bionic uses `sigaltstack` by default in order to provide error messages for
stack overflows by default. However, it was missing a guard page on the tiny
single page signal stack, so non-trivial signal handlers could easily overflow
that stack. CopperheadOS includes a guard page for these, and the change has
been merged upstream.
