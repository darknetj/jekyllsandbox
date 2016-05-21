---
layout:     post
title:      "Copperhead OS: Secure Android ROM"
subtitle:   "A fork of Cyanogenmod with a hardened kernel, security patches, and open-source apps."
date:       2015-04-22 12:00:00
author:     "Dan McGrady"
header-img: "backgrounds/hero.jpg"
header-pos: "center center"
published:  false
---

One of the weakest points in modern business IT set-ups are smartphones, often iPhones or Android devices brought in by employees. Arguably the last time corporations had a reliable secure option was when Blackberry was popular.

So we decided to build a secure-by-default version of Android to fill this void. A phone built for serious private business communications.

A few other competitors have tried selling their versions of Android as secure, but are often simply taking Android, packaging some proprietary encryption apps - then calling the phone secure.

We know there is much more to security than simply encryption apps, so we are focusing on hardening every part of the underlying Android OS to protect against a broader range of attack vectors. Not only are we offering strong encryption but also protecting the device against remote attacks. We are also stripping down the phone and limiting functionality to make human security errors less likely.

Most importantly it will be entirely open-source, from the 'userspace' apps that are preinstalled, such as secure messengers, to the underlying Copperhead OS will be on [github](https://github.com/copperhead/) where you can follow our development.

Features we have completed so far:

- Fixed Android's broken [ASLR](https://en.wikipedia.org/wiki/Address_space_layout_randomization) to make various bugs harder to turn into exploits
- Beginning to port PaX and [GRSecurity](https://grsecurity.net/) to harden the Linux kernel
- Replaced the memory allocator with OpenBSDs hardened omalloc
- TCP/IP network stack hardening
- Improved firewall rules and blacklisting known malware URLs/domains
- and many more...

Check back for more [blog posts](/blog/) in the coming weeks which will highlight our development progress and get into technical details of how we improved security on the device.

We plan to support the development of the OS by selling pre-hardened phones, as well as working with companies who wish to deploy Copperhead phones in their business by providing support, training, and deployment services.

Find out more information about our secure Android phones.

