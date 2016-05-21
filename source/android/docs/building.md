---
layout:      docs
title:       Building
description: Instructions on building CopperheadOS from source and signing releases
---

# Building CopperheadOS from source

## Downloading source code

Note that Android's source tree is huge, so this will use a lot of bandwidth and disk space.

For the Nexus 5 and 9:

    mkdir copperheados
    cd copperheados
    repo init -u https://github.com/CopperheadOS/platform_manifest.git -b marshmallow
    repo sync -j16

For the Nexus 5X, due to the Android Open Source Project moving it to a separate branch:

    mkdir copperheados2
    cd copperheados2
    repo init -u https://github.com/CopperheadOS/platform_manifest.git -b marshmallow2
    repo sync -j16

## Building

You should have at least 8GiB of memory and lots of free disk space to build.

The build has to be done from bash as envsetup.sh is not compatible with other
shells like zsh.

    source build/envsetup.sh
    export LANG=C
    unset _JAVA_OPTIONS
    export BUILD_NUMBER=$(date --utc +%Y.%m.%d.%H.%M.%S)
    export DISPLAY_BUILD_NUMBER=true
    choosecombo release aosp_hammerhead user
    make dist -j4

## Generated signed factory images and/or an upgrade zip

Next, keys need to be generated for signing the build. The sample certificate
subject can be replaced with your own information or simply left as-is.

The keys should not be given passwords due to limitations in the upstream
scripts. If you want to secure them at rest, you should take a different
approach where they can still be available to the signing scripts as a
directory of unencrypted keys.

    mkdir keys
    cd keys
    ../development/tools/make_key releasekey '/C=CA/ST=Ontario/L=Toronto/O=CopperheadOS/OU=CopperheadOS/CN=CopperheadOS/emailAddress=copperheados@copperhead.co'
    ../development/tools/make_key platform '/C=CA/ST=Ontario/L=Toronto/O=CopperheadOS/OU=CopperheadOS/CN=CopperheadOS/emailAddress=copperheados@copperhead.co'
    ../development/tools/make_key shared '/C=CA/ST=Ontario/L=Toronto/O=CopperheadOS/OU=CopperheadOS/CN=CopperheadOS/emailAddress=copperheados@copperhead.co'
    ../development/tools/make_key media '/C=CA/ST=Ontario/L=Toronto/O=CopperheadOS/OU=CopperheadOS/CN=CopperheadOS/emailAddress=copperheados@copperhead.co'
    ../development/tools/make_key verity '/C=CA/ST=Ontario/L=Toronto/O=CopperheadOS/OU=CopperheadOS/CN=CopperheadOS/emailAddress=copperheados@copperhead.co'
    cd ..

Generate the verity public key:

    make generate_verity_key
    out/host/linux-x86/bin/generate_verity_key -convert keys/verity.x509.pem keys/verity_key

Generate a signed release build with the release.sh script:

    ./release.sh hammerhead

The factory images and update package will be in out/release-hammerhead.

release.sh:

~~~ sh
#!/bin/bash

user_error() {
  echo user error, please replace user and try again >&2
  exit 1
}

[[ $# -eq 1 ]] || user_error
[[ -n $BUILD_NUMBER ]] || user_error

KEY_DIR=keys
OUT=out/release-$1

source device/common/clear-factory-images-variables.sh

if [[ $1 == bullhead ]]; then
  BOOTLOADER=bhz10k
  RADIO=m8994f-2.6.30.0.68
  VERITY=true
elif [[ $1 == flounder ]]; then
  BOOTLOADER=3.48.0.0135
  VERITY=true
elif [[ $1 == hammerhead ]]; then
  BOOTLOADER=hhz12k
  RADIO=m8974-2.0.50.2.28
  VERITY=false
else
  user_error
fi

BUILD=$BUILD_NUMBER
VERSION=mmb29v
DEVICE=$1
PRODUCT=$1

mkdir -p $OUT || exit 1

TARGET_FILES=$DEVICE-target_files-$BUILD.zip

if [[ $VERITY == true ]]; then
  EXTRA=(--replace_verity_public_key "$KEY_DIR/verity_key.pub"
         --replace_verity_private_key "$KEY_DIR/verity")
fi

if [[ $DEVICE == bullhead ]]; then
  EXTRA_OTA=(-b device/lge/bullhead/update-binary)
fi

build/tools/releasetools/sign_target_files_apks -o -d "$KEY_DIR" "${EXTRA[@]}" \
  out/dist/aosp_$DEVICE-target_files-$BUILD_NUMBER.zip $OUT/$TARGET_FILES || exit 1

build/tools/releasetools/img_from_target_files $OUT/$TARGET_FILES \
  $OUT/$DEVICE-img-$BUILD.zip || exit 1

build/tools/releasetools/ota_from_target_files --block -k "$KEY_DIR/releasekey" "${EXTRA_OTA[@]}" $OUT/$TARGET_FILES \
  $OUT/$DEVICE-ota_update-$BUILD.zip || exit 1

cd $OUT || exit 1

source ../../device/common/generate-factory-images-common.sh
~~~

## Prebuilt code

Like the Android Open Source Project, CopperheadOS contains some code that's
built separately and then bundled into the source tree as binaries. Ideally,
everything would be built-in tree with the AOSP build system but it's not
always practical.

### Kernel

Unlike AOSP, CopperheadOS builds the kernel as part of the operating system
rather than bundling a pre-built kernel image.

### Chromium and WebView

Chromium and the WebView are independent applications built from the Chromium
source tree. AOSP only includes the WebView as Chrome is added as part of the
Google Play components. There are prebuilt apks bundled at
platform/external/chromium and platform/external/chromium-webview.

See [Chromium's Android build
instructions](https://www.chromium.org/developers/how-tos/android-build-instructions)
for details on obtaining the prerequisites.

    mkdir chromium
    cd chromium
    fetch --nohooks android

Sync to the latest stable revision, which was 49.0.2623.91 at the time of
writing:

    gclient sync --with_branch_heads -r 49.0.2623.91

Then, configure the build:

    cd src
    gn args out/Default

Configuration for 32-bit ARM:

    target_os = "android"
    target_cpu = "arm"
    is_debug = false

    is_official_build = true
    is_component_build = false
    symbol_level = 1
    chrome_public_apk_use_chromium_linker = false
    chrome_public_apk_load_library_from_apk = false

Configuration for 64-bit ARM:

    target_os = "android"
    target_cpu = "arm64"
    is_debug = false

    is_official_build = true
    is_component_build = false
    symbol_level = 1
    chrome_public_apk_use_chromium_linker = false
    chrome_public_apk_load_library_from_apk = false

To build Chromium:

    ninja -C out/Default/ chrome_public_apk

To build the WebView:

    ninja -C out/Default/ system_webview_apk

The 64-bit ARM WebView apk is a special case. The ninja build will produce a
pure 64-bit apk, which then needs to be merged with the 32-bit apk:

    android_webview/tools/apk_merger.py --apk_32bit webview32.apk --apk_64bit webview64.apk \
        --out_apk merged.apk --zipalign_path /opt/android-sdk/build-tools/23.0.2/zipalign \
        --keystore_path build/android/ant/chromium-debug.keystore --key_name chromiumdebugkey \
        --key_password chromium --shared_library libwebviewchromium.so

The apks are signed as part of the build process for the OS after they're
bundled into external/chromium and external/chromium-webview.

### SMSSecure

A prebuilt SMSSecure is included in platform/external/SMSSecure as a
replacement for the AOSP Messaging app. It has many external dependencies
including legacy Android SDK dependencies so an in-tree build is impractical
right now.

See the [SMSSecure build
instructions](https://github.com/SMSSecure/SMSSecure/blob/master/BUILDING.md)
for details.
