/* globals define */
define(['jquery'], function($) {
    'use strict';

    var navigation = {};

    // Fix header on scroll
    navigation.fix = function fix() {
        if ($('.navbar').length && $('.navbar').offset().top > 50) {
            $('.navbar-fixed-top').addClass('top-nav-collapse');
        } else {
            $('.navbar-fixed-top').removeClass('top-nav-collapse');
        }
    };

    navigation.init = function init() {
        navigation.fix();

        // Closes the Responsive Menu on Menu Item Click
        $('.navbar-collapse ul li a').click(function() {
            $('.navbar-toggle:visible').click();
        });

        $(window).scroll(navigation.fix);
    };

    return {
        init: navigation.init
    };
});
