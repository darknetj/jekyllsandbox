---
layout:      docs
title:       Technical Overview
description: Technical overview of the currently implemented features in CopperheadOS
---

# Technical overview of CopperheadOS

This is a technical overview of the currently implemented features in CopperheadOS. For a list of
planned features, see [the issues tagged as enhancements on the
tracker](https://github.com/copperhead/bugtracker/labels/enhancement). The scope will be expanded as
more features are implemented.

## Exec-based spawning model

CopperheadOS spawns applications from the Zygote service in the traditional Unix way with `fork`
and `exec` rather than Android's standard model using only `fork`. This results in the address
space layout and stack/setjmp canaries being randomized for each spawned application rather than
having the same layout and canary values reused for all applications until reboot. In addition to
hardening applications from exploitation, this also hardens the base system as the large, near
root equivalent system\_server service is spawned from the Zygote.

This required some workarounds due to code depending on the Zygote spawning model.

## Security level and advanced configuration

A slider is exposed in Settings -> Security -> Advanced for controlling the balance between
performance and security. By default, it starts at 50%. It provides high level control over
various performance vs. security tunables exposed there. All of the options can also be set
manually rather than using the slider.

## Bionic libc improvements

### Hardened allocator

CopperheadOS replaces the system allocator with a port of OpenBSD's malloc implementation. Various
enhancements have been made to the standard OpenBSD allocator, some of which have been upstreamed.

The allocator doesn't use any inline metadata, so traditional allocator exploitation techniques
are not possible. The out-of-line metadata results in full detection of invalid free calls. It is
guaranteed to abort for pointers that are not active malloc allocations.

The configuration is made read-only at runtime and the rest of the global state is protected to
some extent via randomization and canaries. CopperheadOS has some small extensions to improve the
randomization and may do more in the future.

#### Regions

OpenBSD malloc is a zone-based allocator, similar in design to Android's standard jemalloc
allocator. Unlike jemalloc, it uses page-aligned regions instead of 2MiB aligned regions so it
doesn't cause a loss of mmap randomization entropy. The standard allocator loses 9 bits of mmap
entropy on systems with 4096 byte pages.

A randomized page cache provides a layer on top of mmap and munmap. Spans of pages are cached in
an array with up to 256 slots using randomized searches. Regions are split at this layer but not
merged together. It's meant to provide a thin layer over mmap, partly to benefit from fine-grained
randomization by the kernel. Linux only randomizes the mmap base, unlike OpenBSD, so for now it's
not on par with how it works there.

A user-facing setting is exposed for enabling page cache memory protection to trigger aborts for
use-after-free bugs. For small allocations, a whole page needs to be cleared out for this to work,
but another technique is used to provide a comparable mitigation (see below).

#### Small allocations

Fine-grained randomization is performed for small allocations by choosing a random pool to satisfy
requests and then choosing a random free slot within a page provided by that pool. Freed small
allocations are quarantined before being put back into circulation via a randomized delayed
allocation pool. This raises the difficulty of exploiting vulnerabilities by making the internal
heap layout and allocator behavior unpredictable.

CopperheadOS adds an additional layer to the quarantine to enforce a minimum delay on frees via a
ring buffer. It also uses a hash table to provide enhanced double-free detection by tracking all
delayed allocations within the ring buffer and randomized array. Previously, double-free could not
be detected if the previously freed allocation was still in the quarantine. It also provides
enhanced detection of use-after-free detection via the junk filling and junk validation features.

Small allocations are filled with junk data upon being released. This prevents many information
leaks caused by use without initialization and can make the exploitation of use-after-free and
double free vulnerabilities more difficult. When allocations leave the quarantine, the junk data
is validated to detect write-after-free. By default, 32 bytes are checked and full validation can
be enabled via a user-facing setting. Junk validation was a successfully upstreamed CopperheadOS
extension.

Canaries can be placed at the end of small allocations to absorb small overflows and catch various
forms of heap corruption upon free. It is disabled by default for the time being due to the memory
usage cost and is exposed as a user facing setting. This was a successfully upstreamed
CopperheadOS extension.

#### Large allocations

By default, the leading 2048 bytes of large allocations are junk filled. Full junk filling on free
is available via a user-facing setting. Unlike OpenBSD, filling new allocations with junk data
rather than either zeroes or the junk on free pattern is split out into a separate option (not
exposed to users) as it's much more of an auditing/debugging feature than a security one.

A user-facing setting is exposed for placing guard pages at the end of large allocations to
prevent and detect overflows at the cost of higher memory usage and reduced performance. It may be
enabled by default on 64-bit in the future. Large allocations can be moved as close as possible to
the end of the allocated region in order to trigger faults for small overflows, and CopperheadOS
enables this by default when guard pages are enabled but not otherwise, unlike OpenBSD where it is
simply enabled by default.

### Extended `_FORTIFY_SOURCE` implementation

The `_FORTIFY_SOURCE` feature provides buffer overflow checking for standard C library functions
in cases where the compiler can determine the buffer size at compile-time.

Copperhead has added fortified implementations of the following functions:

* fread - [upstreamed](https://android-review.googlesource.com/#/c/160350/)
* fwrite - [upstreamed](https://android-review.googlesource.com/#/c/160350/)
* getcwd - [upstreamed](https://android-review.googlesource.com/#/c/162664/)
* memchr - [upstreamed](https://android-review.googlesource.com/#/c/147372/)
* memrchr - [upstreamed](https://android-review.googlesource.com/#/c/147372/)
* memcmp
* memmem
* pread - [upstreamed](https://android-review.googlesource.com/#/c/147114/)
* pread64 - [upstreamed](https://android-review.googlesource.com/#/c/147114/)
* pwrite - [upstreamed](https://android-review.googlesource.com/#/c/162665/)
* pwrite64 - [upstreamed](https://android-review.googlesource.com/#/c/162665/)
* readlink - [upstreamed](https://android-review.googlesource.com/#/c/147291/)
* readlinkat - [upstreamed](https://android-review.googlesource.com/#/c/147291/)
* realpath - [upstreamed](https://android-review.googlesource.com/#/c/147365/)
* send - [submitted upstream](https://android-review.googlesource.com/#/c/169960/)
* sendto - [submitted upstream](https://android-review.googlesource.com/#/c/169960/)
* write - [upstreamed](https://android-review.googlesource.com/#/c/162665/)

Additionally, the dlmalloc API has been annotated with `alloc_size` attributes to provide buffer
overflow checking for the remaining code using the extended API.

Some [false positives in jemalloc](https://github.com/jemalloc/jemalloc/pull/250) were fixed in
order to land support for `write` fortification in AOSP.

#### Dynamic object size queries

In CopperheadOS, `_FORTIFY_SOURCE` also provides system calls with dynamic overflow checks. This is
done by calling `__dynamic_object_size` from the fortified system call implementations and using it
rather than the value from `__builtin_object_size` if it's smaller. This feature is included as part
of `_FORTIFY_SOURCE` but it can be disabled by defining `_FORTIFY_SOURCE_STATIC`. It's disabled in
libc itself as it would cause infinite recursion.

The main component of the `__dynamic_object_size` feature is querying malloc for the object size.
OpenBSD malloc tracks allocation metadata entirely via out-of-line data structures so it can
accurately respond to these queries with either the size class of the allocation or a sentinel
value.

Before querying malloc, there's special handling for addresses within the calling thread's stack,
the executable and the isolated library region. These paths can only give a rough upper bound or
abort the process if the address isn't part of any valid object. It reduces the performance cost of
the feature because querying malloc is relatively expensive.

It's restricted to system calls as it would be too expensive elsewhere. It may be extended into a
configurable feature by having a single branch on a read-only global set during initialization from
a setting. Calls like fread and fwrite sit in a middle ground between calls like memcpy and system
calls so there could be 3 levels to the performance vs security compromise: off, system calls,
system calls + fread/fwrite and everything. This would end up being part of a high level performance
vs. security slider exposed to users.

### Function pointer protection

Writable function pointers in libc have been eliminated, removing low-hanging fruit for hijacking
control flow with memory corruption vulnerabilities.

The `at_quick_exit` and `pthread_atfork` callback registration functions have been extended with
the same memory protection offered by the `atexit` implementation inherited from OpenBSD.

The vDSO function pointer table is made read-only after initialization, as is the pointer to the
function pointer table used to implement Android's malloc debugging features. This has been
[upstreamed](https://android-review.googlesource.com/#/c/159730/).

Mangling of the setjmp registers was [implemented
upstream](https://android-review.googlesource.com/#/c/170157/) based on input from Copperhead.

### Miscellaneous improvements

Allocations larger than `PTRDIFF_MAX` are prevented, preventing a class of
overflows. This has been upstreamed for
[mmap](https://android-review.googlesource.com/#/c/170800/) and
[mremap](https://android-review.googlesource.com/#/c/181202/).

A dedicated memory region is created for mapping libraries, to isolate them from the rest of the
mmap heap. It is currently 128M on 32-bit and 1024M on 64-bit. A randomly sized protected region
of up to the same size is placed before it to provide a random base within the mmap heap. The
address space is reused via a simple address-ordered best-fit allocator to keep fragmentation at a
minimum for dynamically loaded/unloaded libraries (plugin systems, etc.).

Secondary stacks are randomized by inserting a random span of protected memory above the stack and
choosing a random base within it. This has been [submitted
upstream](https://android-review.googlesource.com/#/c/161453/).

Secondary stacks are guaranteed to have at least one guard page above the stack, catching sequential
overflows past the stack mapping. The `pthread_internal_t` structure is placed in a separate mapping
rather than being placed within the stack mapping directly above the stack. It contains thread-local
storage and the value compared against stack canaries is stored there on some architectures.

Signal stacks were given guard pages to catch stack overflows. This was
[upstreamed](https://android-review.googlesource.com/#/c/144365/).

Assorted small improvements:

* have getauxval(...) set errno to ENOENT for missing values, per glibc 2.19 -
  [upstreamed](https://android-review.googlesource.com/#/c/142250/)
* name the atexit handler pages - [upstreamed](https://android-review.googlesource.com/#/c/161429/)
* name the arc4random structure mappings - [upstreamed](https://android-review.googlesource.com/#/c/162770/)
* fix the mremap signature - [upstreamed](https://android-review.googlesource.com/#/c/180130/)
* implementations of `explicit_memset` and `secure_getenv` for use elsewhere
* replaced the broken implementations of `issetugid` and `explicit_bzero`
* larger default stack size on 64-bit (1MiB -> 8MiB)
* and more...

## PaX kernel

CopperheadOS has ports of the PaX kernel hardening patch to the supported devices. It may use a
larger subset of grsecurity in the future, but most of the additional features over PaX are not
usable on Android or are already provided in other ways. It would make more sense to extract only
the useful features (PROC\_MEMMAP, KSTACKOVERFLOW, HIDESYM, RANDSTRUCT, DEVICE\_SIDECHANNEL,
RWXMAP\_LOG and maybe a few more) rather than maintaining a full port.

### Userspace features

PaX's userspace hardening features are all enabled. The RANDMMAP feature provides significantly
stronger Address Space Layout Randomization (ASLR) than the vanilla kernel and eliminates the mmap
address hint footgun. PAGEEXEC turns no-execute violations into fatal errors rather than
recoverable ones. MPROTECT prevents runtime code modification/injection.

There are a few MPROTECT exceptions (mediaserver, mm-qcamera-app, mm-qcamera-daemon) for the base
system to work around proprietary libraries that are not easily fixable. CopperheadOS contains a
custom exception system for dealing with Android applications via group-based permissions and has
package manager integration to set the permissions automatically. The package manager scans for
calls to the WebView widget's setJavaScriptEnabled method in an Android package's bytecode and
automatically adds MPROTECT exceptions as necessary. The remaining issues are dealt with using a
hard-wired exception table in the package manager mapping application names like com.chrome.beta
to a list of necessary exceptions. Very few of these manually made exceptions are required and
more issues could be auto-detected in the future.

A toggle for soft mode is exposed in Settings -> Developer options along with a status entry in
Settings -> About device displaying whether a PaX kernel is in use and the soft mode setting.

### Kernel self-protection

Some kernel self-protection features are enabled (MEMORY\_SANITIZE, REFCOUNT, USERCOPY) along with
the baseline improvements without configuration options. KERNEXEC and UDEREF will be available for
devices using the 3.10 kernel. The features implemented via compiler plugins have been tested and
are work well, but the necessary changes to support them are unfinished and aren't yet published.

## Compiler hardening

* Lightweight bounds checking for statically sized arrays via -fsanitize=bounds
  -fsanitize-trap=bounds.
* For some sub-projects, lightweight object size bounds checking is performed
  (including extended checks for arrays) via -fsanitize=object-size
  -fsanitize-trap=object-size. This has a lot of overlap with the bounds
  sanitizer, but the redundant checks are optimized out when both are set to trap
  on error. It would be nice to enable this globally, but there's too much code
  relying on undefined out-of-bounds accesses.
* For some sub-projects, both unsigned and signed integer overflow checking via -fsanitize=integer
  -fsanitize-trap=integer (mostly backported from AOSP master).
* Stack overflow checking for supported architectures via -fstack-check (not on ARM yet due to a
  [severe bug](https://gcc.gnu.org/bugzilla/show_bug.cgi?id=65958)) - submitted upstream [for the
  NDK](https://android-review.googlesource.com/#/c/163710/)
* Signed integer overflow is made well-defined via -fwrapv to avoid having incorrectly written
  overflow checks optimized out.
* Expanded stack overflow canaries to all relevant functions via -fstack-protector-strong for both
  the NDK and base system. It has also been upstreamed for both the
  [NDK](https://android-review.googlesource.com/#/c/143084/) and [base
  system](https://android-review.googlesource.com/#/c/185410/).
* Added `-Wsuggest-attribute=format` warning to audit for missing format attributes - dozens of
  cases have been found and fixed, providing more coverage for warnings about exploitable format
  string bugs.

## Enhanced SELinux policies

* eliminated code injection holes
    * removed gpu\_device execute access - upstreamed
    * removed ashmem execute access
    * removed tmpfs execute access
    * the remaining hole in full (not just in-memory) w^x is app\_data\_file
      execution, and the intention is to address this with a whitelisting model
      in the package manager similar to the handling of PaX exceptions
* removed mediaserver's write access to sysfs - upstreamed

## Encryption and authentication

Full disk encryption is enabled by default on all supported devices, not just those shipping that
way with the stock operating system.

### Support for a separate encryption password

In vanilla Android, the encryption password is tied to the lockscreen password. That's the default
in CopperheadOS, but there's full support for setting a separate encryption password. This allows
for a convenient pattern, pin or password to be used for unlocking the screen while using a very
strong encryption passphrase. If desired, the separate encryption password can be removed in favor
of coupling it to the lockscreen password again.

When a separate encryption password is set, the lockscreen will force a reboot after 5 failed
unlocking attempts to force the entry of the encryption passphrase. This makes it possible to use a
convenient unlocking method without brute force being feasible. It offers similar benefits as wiping
after a given number of failures or using a fingerprint scanner without the associated drawbacks.

### Support for longer passwords

The maximum password length is raised from 16 characters to 32 characters.

## Better defaults

The default settings have been altered to emphasize privacy/security over small conveniences.

Location tagging is disabled by default in the Camera app, and there is no longer a prompt about
choosing whether to enable it on the first launch. It can still be enabled using the Camera's
settings menu.

* passwords are hidden by default
* sensitive notifications are hidden on the lockscreen by default
* NFC and NDEF Push are disabled by default

## Security-focused built-in apps

The Messaging application is replaced with SMSSecure for authenticated encryption via SMS.

The obsolete Browser applications is replaced with a build of Chromium. The per-site-instance
sandbox sets it apart from other browsers. The WebView library is built from the Chromium source
tree but it doesn't include the Chromium sandbox. Chromium has much less freedom as a library so
providing sandboxing in that context wouldn't be clear cut.

## Over-the-air updates

CopperheadOS uses an extremely simple over-the-air update server written in Go paired with a
security-focused fork of CyanogenMod's update client. The client has been ported to using private
downloads and an internal storage directory rather than using shared storage so other apps can't
interfere with updates.  CopperheadOS is fully signed (unlike CyanogenMod) so an update modified by
another app would fail to pass signature verification in the recovery image but using shared data
would allow other apps to prevent updating. It has also been altered to work properly with
encryption enabled with a normal recovery image. CyanogenMod expects the recovery to prompt the user
for the encryption password and mount the data partition.

## Miscellaneous features

SQLite's `SECURE_DELETE` feature is enabled, resulting in deleted content being overwritten with
zeros. This prevents sensitive data from lingering around in databases after it's deleted. SQLite
is widely used by Android's base system is the standard storage mechanism for applications, so
this results in lots of coverage. This has been
[upstreamed](https://android-review.googlesource.com/#/c/209123/). The default journal mode is
also set to `TRUNCATE` rather than `PERSIST` to stop data from lingering in the journal after
transactions. This change has also been
[upstreamed](https://android-review.googlesource.com/#/c/210080/).

The hidepid=2 option is enabled for procfs, hiding processes owned by other
UIDs. Since non-system apps each have a unique UID, this prevents apps from
obtaining sensitive information about each other via /proc. There are
exceptions for a few of the core services via the gid mount option (lmkd,
servicemanager, keystore, debuggerd, logd, system\_server) but not for apps. A
subset of this was provided by SELinux, but it isn't fine-grained enough. This
enhancement was [adopted
upstream](https://android-review.googlesource.com/#/c/181345/) based on the
implementation in CopperheadOS (it had been planned, but they were unaware of
the gid mount option).

Some misuses of `memset` for sanitizing data were replaced with `explicit_memset`, to stop the
compiler from optimizing them out.

Interfaces are given a random MAC address whenever they are brought up. This can be disabled via a
toggle in the network settings. The hostname is randomized at boot by default, and it can also be
disabled in order to use the persistent hostname based on `ANDROID_ID` instead.

The kernel TCP/IP settings are adjusted to prioritize security. A minimal firewall is provided
with some options that are always sane. Support for IP sets is enabled in the kernel and the ipset
utility is provided, but not yet integrated in an automated way. Android has group-based control
over networking so basic controls over networking are in the realm of PrivacyGuard, but more
advanced firewall features might be provided down the road.

Many global function pointers in Android's codebase have been made read-only. This is ongoing work
and will need to be complemented with Control Flow Integrity (CFI) as many are compiler-generated.
Some of this work has been upstreamed: [1](https://android-review.googlesource.com/#/c/172190/),
[2](https://android-review.googlesource.com/#/c/172140/).

The `kernel.perf_event_paranoid` sysctl is set to 2 by default and is exposed via the
`persist.security.perf_harden` property.  The plan is to expose it in developer settings. It will
likely be enhanced with a port of the grsecurity `PERF_HARDEN` feature without the read-only
portion.
