/* globals define, log */
define([
  'jquery',
  'views/layout/layout',
  'views/homepage/homepage',
  'views/android/downloads',
  'views/android/donate',
  'views/subpage/contact_form',
  'bootstrap',
  'handlebars'
], function(
    $,
    layout,
    homepage,
    androidDownloads,
    donate,
    contact
) {
    var initialize = function() {
        'use strict';

        $(function() {
            // Shared
            layout.init();

            // Sections
            homepage.init();
            androidDownloads.init();
            donate.init();
            contact.init();
        });
    };

    return {
        initialize: initialize
    };
});
