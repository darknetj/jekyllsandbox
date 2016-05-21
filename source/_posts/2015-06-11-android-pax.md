---
layout:     post
title:      "Integrating PaX into Android"
subtitle:   "Addressing the Android platform's peculiarities for proper PaX
support."
date:       2015-06-11 12:00:00
author:     "Daniel Micay"
header-img: "backgrounds/post8.jpg"
header-pos: "center center"
published:  true
---

The PaX project provides many exploit mitigation features to harden the Linux
kernel far beyond the baseline security features provided by upstream. Android
is close enough to a normal Linux distribution for it to work quite well
out-of-the-box after doing some kernel porting work, but there are unique
issues necessitating deeper integration work to achieve similar benefits to PaX
on a more typical distribution.

Reading the last article on [the state of address-space layout randomization on
Android](/blog/2015/05/11/aslr-android-zygote) is recommended but not strictly
necessary. The relevant bits will be linked back to as appropriate.

## PaX kernel features

PaX's kernel self-protection features break a fair bit of kernel code and
require changes throughout the kernel source tree. Since each Android device
has a custom kernel with out-of-tree drivers, leveraging some features can be
painful. Fixing the common compatibility issues is very straightforward because
the error messages point directly to the problem.

In many cases compatibility issues exist because real bugs are detected rather
than remaining undetected. However, on Android these issues are almost always
fixed in mainline and simply weren't backported to either the upstream
long-term support (LTS) branches, Google's baseline Android kernels derived
from upstream (but without any real world device support) or the per-device
kernels based upon those. For example, PaX's USERCOPY feature was broken by the
incorrect implementation of `virt_addr_valid` on ARM in the 3.4 kernels used on
most Android devices. PaX now includes a backport of this fix in the 3.2 LTS
patch, so a fresh port of the LTS fixes to 3.4 wouldn't hit this.

The common causes of issues in the out-of-tree drivers are false positive
reference count overflows (PAX_REFCOUNT) requiring more atomic integer fields
marked as unchecked, false positive size overflows (PAX_SIZE_OVERFLOW) detected
at runtime by the GCC plugin requiring parameters to be marked as permitting
overflow and data structures that are automatically constified by the constify
plugin (PAX_CONSTIFY_PLUGIN) which need to be marked as non-constant.

## PaX userspace features

In addition to the many kernel self-protection features, PaX hardens userspace
code against exploitation. In the kernel, incompatibilities with the hardening
features can be fixed or worked around internally. Userspace code runs into
similar issues so PaX supports an exception system for toggling hardening
features on and off for specific executables. The modern method for doing this
is via extended attributes rather than modifying the executables, and this
works fine on Android's ext4 and f2fs filesystems.

### MPROTECT

PaX's MPROTECT feature prevents executable code from being modified or created
at runtime. This prevents processes from making themselves vulnerable by
creating executable code at runtime. It also prevents an attacker from
escalating to generating their own code after hijacking the existing code
and/or data via techniques like return-oriented programming. A notable hole in
the protection is that files can be mapped as executable so that things like
libraries still work, so it works best when combined with a solid mandatory
access control policy.

In practice, the main benefit is enforcing a policy of no runtime code
generation so that each violation can be investigated and ideally fixed rather
than just adding exceptions.

#### Upstream Android

SELinux has a set of features that's quite similar to PaX's MPROTECT: execheap,
execstack, execmem and execmod. However, Android has blanket exceptions in the
SELinux policy turning off execmem nearly everywhere. This was necessary to
take advantage of Dalvik's optional just-in-time (JIT) compilation and may be
necessary if the new Android runtime ever moves away from the currently pure
ahead-of-time compilation model. Applications could be handled quite easily
upstream by implicitly adding the permission to all applications using the old
API Level and letting time take care of the rest.

#### Text relocations

On Android, all code is supposed to be position independent. Dynamic libraries
(ELF shared objects) fundamentally require the ability to be mapped anywhere in
the address space and Android also requires that all executables are position
independent in order to support full ASLR. However, some code is not truly
position independent and requires that the linker performs runtime rewrites
(relocations) to set the correct addresses. This is almost always caused by
incorrect assembly code ignoring position independence.

Android used the migration to 64-bit architectures as an opportunity to drop
many legacy features from the ABI. Among these changes was dropping support for
text relocations in Bionic's linker. The linker now considers [text relocations
in ELF binaries to be fatal errors on 64-bit
architectures](https://android.googlesource.com/platform/bionic.git/+/e4d792adb8d6f9228b9ac9dc1ad7f43b271f085f).
On 32-bit, it has [produced a
warning](https://android.googlesource.com/platform/bionic.git/+/c9084427aa15259c8bfb9b13b979597a4abd1805)
for quite some time but application developers can and will just ignore this.
The change on 64-bit forced projects like FFmpeg and VLC to deal with this in
their ARMv8-A code, but the problems remain on 32-bit. There was [an attempt to
remove it on
32-bit](https://android.googlesource.com/platform/bionic.git/+/cb00add1b382d1e3045876d7e1ccbee2fdce976b)
but it [was reverted](https://android.googlesource.com/platform/bionic.git/+/56be6ed9e4ac99fdd920090ee89c57e3cf55e885). Sadly,
Android's main bug tracker is private so the rationale and roadmap can only be
guessed.

PaX does have a kernel configuration option for permitting text relocations
(PAX_ELFRELOCS), but this reduces the security of the system as a whole. It
makes more sense to disable MPROTECT for the very few applications with this
bug. Text relocations fall under execmod with the similar SELinux feature, so
it's possible to have slightly finer-grained control by disabling MPROTECT and
using the SELinux policy to allow only execmod. CopperheadOS could use this to
offer finer-grained permissions, but text relocations are almost already purged
from Android so it doesn't appear to be worth the added complexity.

#### Just-in-time compilers

The primary cause for PaX MPROTECT (and SELinux execmem) violations is JIT
compilation. There's an increasing trend towards generating optimized
executable code at runtime for everything from high level languages and regular
expressions to rule engines.

On Android, the primary cause is the V8 JavaScript virtual machine in the
Chromium-based WebView widget. There are *many* applications making use of the
WebView and enabling JavaScript support. It's commonly used for things like
advertisements and poorly integrated embedded images and videos. There are also
many WebView-based browser applications and countless applications that are
little more than a thin wrapper around an embedded browser for a specific use
case like visiting articles from a news feed.

In addition to the WebView, there's also the copy of V8 in Chrome itself and
other JavaScript JIT compilers like Firefox's SpiderMonkey. These issues aren't
substantially different from how things are on the desktop though.

### PAGEEXEC

The PAGEEXEC feature provides PaX's implementation of no-execute permissions.
Android devices have NX bit support so it simply tightens up the existing
system. For example, it prevents recovery via a signal handler from violations
of the no-execute permissions on memory. The need for exceptions from this on
platforms that already have no-execute permissions is rare, but some
applications do go out of the way to break things. For example, SpiderMonkey's
garbage collector results in NX violations when combined with just-in-time
compilation as it generates segmentation faults as part of the design.

Android doesn't have any unique problems necessitating more PAGEEXEC exceptions
than usual. There aren't any known cases beyond SpiderMonkey.

### RANDMMAP

PaX's implementation of address-space layout randomization can cause
compatibility issues and the entire set of features is rolled back to vanilla
behavior by turning off RANDMMAP (not just mmap randomization. Unlike the other
features, any application requiring an exception from this is certainly buggy
as it depends on implementation details.

The primary cause of these issues is the assumption that mmap will make use of
the address hint, even though it's very explicitly defined as an ignorable hint
when MAP_FIXED isn't used. PaX ignores it because it's commonly used by
applications to shoot themselves in the foot with deterministic address space
layout. Android's runtime is one example where this proves useful, [as was
covered in the previous
article](/blog/2015/05/11/aslr-android-zygote#android-runtime-art).

RANDMMAP exceptions are rarely necessary now, and that seems to be especially
true on Android. These exceptions are almost always needed for legacy code
that's not going to run on Android anyway, so as with PAGEEXEC it hasn't been
an issue so far.

## Android throws a wrench in the works

PaX's executable-based permission system does *work* on Android. Executables
can be marked with the appropriate user.pax.flags extended attributes as
necessary. It needs MPROTECT exceptions for a few services like mediaserver,
mm-qcamera-app and mm-qcamera-daemon.

The problem lies in the fact that applications on Android run as the
/system/bin/app_process binary (specifically, either /system/bin/app_process32
or /system/bin/app_process64, as app_process is now a symlink). For example,
since the Firefox apps need PAGEEXEC exceptions, fixing it with the typical
executable-based marking system will disable the feature for every other
application. This system for running applications is core to the [Zygote
process spawning
model](/blog/2015/05/11/aslr-android-zygote#zygote-process-spawning-model)
but it can't be discarded even without the standard Zygote spawning model.
Android applications are bundles of code, a manifest and various other
resources and miscellaneous bits, *not* ELF binaries.

### Permission-based PaX exceptions

The approach to the problem in [CopperheadOS](/android) is to leverage Android's existing
application permission system for handling the PaX exceptions.

Android permissions are often implemented simply as checks for requests done
via interprocess message passing, but it also makes heavy usage of the POSIX
permissions system. Each Android application is assigned a unique AID (Android
ID), which is a matching uid/gid pair used as the uid and primary gid. Many
permissions have their own AIDs, and applications with the permissions run with
the corresponding secondary group ids. The purpose of the group ids is that the
kernel understands them, so they can be leveraged via POSIX file permissions,
SELinux and checks based on group ids that are hard-wired into the kernel by
Android. For example, it gates networking support on membership in certain
groups much like [grsecurity's group-based socket
features](https://en.wikibooks.org/wiki/Grsecurity/Appendix/Grsecurity_and_PaX_Configuration_Options#Socket_restrictions).

Android's database for the AIDs used by the core system and permissions is
hard-wired [in a C header
file](https://android.googlesource.com/platform/system/core/+/master/include/private/android_filesystem_config.h)
so CopperheadOS extends it with an AID for each PaX exception: pax_no_pageexec,
pax_no_mprotect and pax_no_randmmap. It then [adds 3 new
permissions](https://github.com/copperhead/android_frameworks_base/commit/034457b99d8ad3e759f83b48ffcb83b3e0c429e6)
and maps them to the appropriate groups.

Extending PaX to support this new form of exceptions is surprisingly simple. It
checks if the executable is marked with an extended attribute opting in to the
permission-based system, and then handles membership in the groups by disabling
the corresponding feature.

~~~ diff
diff --git a/fs/binfmt_elf.c b/fs/binfmt_elf.c
index 03972f1..8232384 100644
--- a/fs/binfmt_elf.c
+++ b/fs/binfmt_elf.c
@@ -9,6 +9,7 @@
  * Copyright 1993, 1994: Eric Youngdale (ericy@cais.com).
  */
 
+#include <linux/android_aid.h>
 #include <linux/module.h>
 #include <linux/kernel.h>
 #include <linux/fs.h>
@@ -879,6 +880,31 @@ static long pax_parse_pax_flags(const struct elfhdr * const elf_ex, const struct
 }
 #endif
 
+static bool pax_has_aids_xattr(struct dentry *dentry)
+{
+	struct inode *inode = dentry->d_inode;
+
+	if (inode_permission(inode, MAY_EXEC))
+		return false;
+
+	if (inode->i_op->getxattr)
+		return inode->i_op->getxattr(dentry, XATTR_NAME_PAX_AIDS, NULL, 0) >= 0;
+
+	return false;
+}
+
+static void pax_handle_aids(struct file * const file)
+{
+	if (!pax_has_aids_xattr(file->f_path.dentry))
+		return;
+	if (in_group_p(AID_PAX_NO_PAGEEXEC))
+		current->mm->pax_flags &= ~MF_PAX_PAGEEXEC;
+	if (in_group_p(AID_PAX_NO_MPROTECT))
+		current->mm->pax_flags &= ~MF_PAX_MPROTECT;
+	if (in_group_p(AID_PAX_NO_RANDMMAP))
+		current->mm->pax_flags &= ~MF_PAX_RANDMMAP;
+}
+
 /*
  * These are the functions used to load ELF style executables and shared
  * libraries.  There is no binary dependent code anywhere else.
@@ -1094,6 +1120,8 @@ static int load_elf_binary(struct linux_binprm *bprm, struct pt_regs *regs)
        }
 #endif
 
+	pax_handle_aids(bprm->file);
+
 #ifdef CONFIG_PAX_HAVE_ACL_FLAGS
        pax_set_initial_flags(bprm);
 #elif defined(CONFIG_PAX_HOOK_ACL_FLAGS)
diff --git a/include/linux/android_aid.h b/include/linux/android_aid.h
index 0f904b3..fa4e4db 100644
--- a/include/linux/android_aid.h
+++ b/include/linux/android_aid.h
@@ -25,4 +25,8 @@
 #define AID_NET_BW_STATS 3006  /* read bandwidth statistics */
 #define AID_NET_BW_ACCT  3007  /* change bandwidth statistics accounting */
 
+#define AID_PAX_NO_PAGEEXEC 3013  /* disable PaX's PAGEEXEC feature */
+#define AID_PAX_NO_MPROTECT 3014  /* disable PaX's MPROTECT feature */
+#define AID_PAX_NO_RANDMMAP 3015  /* disable PaX's RANDMMAP feature */
+
 #endif
diff --git a/include/linux/xattr.h b/include/linux/xattr.h
index cf5f26c..9501bb8 100644
--- a/include/linux/xattr.h
+++ b/include/linux/xattr.h
@@ -60,7 +60,9 @@
 /* User namespace */
 #define XATTR_PAX_PREFIX XATTR_USER_PREFIX "pax."
 #define XATTR_PAX_FLAGS_SUFFIX "flags"
+#define XATTR_PAX_AIDS_SUFFIX "aids"
 #define XATTR_NAME_PAX_FLAGS XATTR_PAX_PREFIX XATTR_PAX_FLAGS_SUFFIX
+#define XATTR_NAME_PAX_AIDS XATTR_PAX_PREFIX XATTR_PAX_AIDS_SUFFIX
 
 #ifdef  __KERNEL__
~~~

This model is then used for `app_process32`, `app_process64`, `dalvikvm32` and
`dalvikvm64`. The result is a finer-grained exception model where the same executable can have different PaX features enabled depending on permissions:

~~~ sh
root@hammerhead:/ # pgrep smssecure
5291
root@hammerhead:/ # readlink /proc/5291/exe
/system/bin/app_process32
root@hammerhead:/ # grep PaX /proc/5291/status
PaX:	PeMRs
root@hammerhead:/ # pgrep browser
5031
root@hammerhead:/ # readlink /proc/5031/exe
/system/bin/app_process32
root@hammerhead:/ # grep PaX /proc/5031/status
PaX:	PemRs
~~~

#### Leveraging the permission-based exception system

Making use of the new permissions is as simple as adding a line to the
`AndroidManifest.xml` for an application:

~~~ xml
<uses-permission android:name="android.permission.PAX_NO_MPROTECT"/>
~~~

However, CopperheadOS needs to handle applications that are not included within
Android's source tree. To do this, it implements [a PaX exception database
within Android's package
manager](https://github.com/copperhead/android_frameworks_base/blob/b7b109f3fc2765edfcf553d2e49f451ebc5981c2/core/java/android/content/pm/PackageParser.java#L206-L258)
and applies the exceptions based on the globally unique names of Android
applications.

An exception is defined like this:

~~~ java
new PackageParser.PaxExceptionInfo("com.duckduckgo.mobile.android",
        new String[] { android.Manifest.permission.PAX_NO_MPROTECT }),
~~~

and is then part of the permissions granted upon installation:

![The MPROTECT exception in the list of permissions for DuckDuckGo]({{ 'blog/PaX-permission-screenshot.png' | asset_path }})
`The MPROTECT exception in the list of permissions for DuckDuckGo`

Updates to the base system will result in all apps being run through the
package manager again, so there's no need to handle new permissions in a
special way. Android already has workarounds to deal with split and new
permissions, albeit not based on an internal list of applications.
