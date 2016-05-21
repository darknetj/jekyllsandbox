---
layout:      docs
title:       Installation
description: Instructions on installing and updating CopperheadOS
---

# Installing CopperheadOS

CopperheadOS currently supports the following devices:

- Nexus 5
- Nexus 9
- Nexus 5X

## Prerequisites

You can obtain the adb and fastboot tools from the Android SDK. Update the SDK
before proceeding with installation. Avoid distribution packages for the tools
unless they are up-to-date (v6.0.1\_r17 or later).

## Enabling OEM unlocking

On the Nexus 9 and Nexus 5X, OEM unlocking needs to be enabled from within the
operating system.

Enable the developer settings menu by going to Settings -> About device and
pressing on the build number menu entry until developer mode is enabled.

Next, go to Settings -> Developer settings and toggle on the 'Enable OEM
unlocking' setting.

## Flashing the factory images

The initial install should be performed by flashing the factory images. This
will wipe all the existing data. The factory images tarball can be downloaded
from the [builds page](/android/downloads).

First, boot into the bootloader interface. You can do this by turning off the
device and then turning it on by holding both the Volume Down and Power
buttons. Alternatively, you can use `adb reboot bootloader` from Android.

The bootloader now needs to be unlocked to allow flashing new images:

    fastboot oem unlock

On the Nexus 5X, the command needs to be confirmed on the device.

Next, extract the factory images and run the script to flash them.

    tar xvf hammerhead-factory-2015.12.18.00.36.25.tar.gz
    cd hammerhead-mmb29m
    ./flash-all.sh

On the Nexus 5X, you should now proceed to locking the bootloader before using
the device as locking wipes the data again.

## Locking the bootloader

Locking the bootloader is recommended. However, it's off the table if you plan
on installing third party zips like gapps. The default recovery image must be
used to benefit from locking since it enforces signature validation for the
updates it installs via sideloading or over-the-air updates. Most third party
recovery images also offer features like recovery root access via adb without
forcing the entry of the encryption password.

Reboot into the bootloader menu and set it to locked:

    fastboot oem lock

On the Nexus 5X, the command needs to be confirmed on the device.

This prevents flashing images without unlocking again, which implies a wipe of
the userdata partition.

On the Nexus 9 and Nexus 5X, you can toggle off OEM unlocking in the developer
settings menu within the operating system. This prevents anyone without the
encryption password from flashing images or erasing partitions. The primary
benefit is theft deterrence. Note that CopperheadOS prevents bypassing the OEM
unlocking toggle by wiping the data partition from the hidden recovery menu,
unlike stock Android. You can still trigger a factory reset from within the OS.

## Updating

### Update client

CopperheadOS checks for updates on a daily basis by default. It can be
configured in Settings -> About device -> System updates.

### Sideloading

Updates can also be downloaded from [the downloads page](/android/downloads)
and installed via recovery with adb sideloading.

First, boot into recovery. You can do this either by using `adb reboot
recovery` from the operating system or selecting the Recovery option in the
bootloader menu.

Next, access the recovery menu by holding down the power button and pressing
the volume up button a single time.

Finally, select the "Apply update from ADB" option in the recovery menu and
sideload the update with adb:

    adb sideload hammerhead-ota_update-2015.12.18.00.36.25.zip

## Reporting bugs

Bugs (or feature requests) should be reported to [the issue tracker on
GitHub](https://github.com/copperhead/bugtracker/issues).
