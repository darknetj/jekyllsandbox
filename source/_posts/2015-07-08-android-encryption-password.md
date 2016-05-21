---
layout:     post
title:      "Separating Android's encryption and lockscreen passwords"
title-size: "52px"
subtitle:   "Addressing a long-standing weakness in Android's encryption support"
date:       2015-07-08 12:00:00
author:     "Daniel Micay"
header-img: "backgrounds/locks.png"
header-pos: "center top"
published:  true
---

Android has a [robust implementation of encryption for the data
partition](https://source.android.com/devices/tech/security/encryption/) where
all system/user data is stored. It's also quite convenient as it can be enabled
out of the box by the operating system. It becomes useful as soon as a
lockscreen password is set.

The feature falls short for users actively seeking to secure their device as
it's inherently tied to the lockscreen password. By default, the screen will be
locked after 5 seconds of sleep so it's too inconvenient to set a complex
password. A smartphone's user experience is quite different when sending a text
message or glancing at a map requires typing a 26 character passphrase with
capitals, numbers and symbols on a tiny touch keyboard.

There are apps for setting a separate passphrase on rooted devices but it will
be overwritten when the lockscreen password is changed. CopperheadOS includes
first-class support for a separate encryption password without losing the
convenience and out of the box security from initially having it tied to the
lockscreen password.

## Backend changes

The [low-level changes to support this
feature](https://github.com/copperhead/android_frameworks_base/commit/b83800ef8d2d9de2aa79aa6ff6a02238860f1864)
are straightforward and have been [submitted
upstream](https://android-review.googlesource.com/#/c/154841/) (but not yet
reviewed). A `lock_separate_encryption_password` setting tracks whether the
encryption password is split from the lockscreen password. The code paths for
setting lockscreen passwords/pins/patterns conditionally update the encryption
password based on the setting rather than doing it unconditionally. There are
also simple public methods for checking if it is set, setting/changing the
split password and replacing it by tying it back to the lockscreen password.

## Frontend UI

The feature is exposed in the Security settings menu in the Settings app.

There's [a new menu
entry](https://github.com/copperhead/android_packages_apps_Settings/commit/e621e85213384561dd0d5b8dbedf55e9371911ed)
shown in the Encryption section if the data partition is encrypted for setting
a separate encryption password. It's simply based on the existing
password/pin/pattern entry widgets.

![Settings before]({{ 'blog/before_separate_encryption_password.png' | asset_path }})

While implementing this, I discovered [a
bug](https://android-review.googlesource.com/#/c/156976/) with the existing
widgets allowing the initial password confirmation to be skipped via
cancellation. It's not a big deal because confirming the password at all is not
strictly necessary and it's not the usual code path taken by the Settings app.
It would be nice if there was more code reuse so issues wouldn't need to be
fixed in 3 places (4 in CyanogenMod and now 5 in CopperheadOS; out-of-tree
refactors would be a bad idea).

Once the separate encryption password is in place, a [second menu
entry](https://github.com/copperhead/android_packages_apps_Settings/commit/4eb0ff926840ca8129d80beb5ed09b84f914f4f7)
appears for replacing it with the lockscreen password. Thankfully, this just
requires a bit of glue code.

![Settings after]({{ 'blog/after_separate_encryption_password.png' | asset_path }})

## Preventing brute-forcing

Permitting a strong encryption password without losing convenience is a nice
improvement but a weak pin is still a liability without some form of brute
force protection. CopperheadOS will likely just force a reboot after N (perhaps
5) failed attempts to force the entry of a stronger encryption password. This
will be enabled by default if a separate encryption password is set. Wiping the
data partition would be extreme and doesn't offer stronger guarantees than a
reboot as the attacker can just reboot it themselves.
