Copperhead
=================

Our marketing website and blog.

It's powered by Jekyll & SCSS to compile to static HTML, CSS, etc.


Development Setup
-------------------------------------------------------------

1) Make sure you have Ruby, version 2.0 or above is probably fine. Your OS package manager should have it or download & install `rvm` (it's slightly annoying)

2) Make sure you have Bundler installed:

    gem install bundler

3) Install the dependencies for static compilation:

    make install


Usage
-------------------------------------------------------------

Run Jekyll in the foreground and watch for new changes you make, automatically updating the compiled output:

    make server

PLEASE NOTE THAT URL-REWRITING DOESN'T EXIST ON LOCAL DEV SERVER:

If you get a 404 page when clicking a link, try adding `.html` to the end.


Notes
-------------------------------------------------------------

Learn Jekyll and how it saves you time making static webpages

    https://jekyllrb.com/docs/home/

Learn SCSS, a CSS extension to make it easier to read/write

    http://sass-lang.com/
