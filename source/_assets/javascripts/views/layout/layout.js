/* globals define */

define([
  'views/layout/navigation',
  'views/layout/email_capture'
], function(navigation, cta) {
    'use strict';

    var init = function() {
        navigation.init();
        cta.init();
    };

    return {
        init: init
    };
});
