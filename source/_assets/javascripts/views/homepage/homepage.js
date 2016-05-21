/* globals define */
define([
    'jquery',
    'views/homepage/map',
    'vendor/covervid'
], function($, maps) {
    'use strict';

    var video = function video() {
        // Resposition content based on header video
        var el = $('.header-video');
        var top = $('#cell-tower').height() + 50;
        if (top < 800) {
            $('.homepage-content').attr('style', 'top: ' + top + 'px');
        }

        // Resize video dynamically
        el.coverVid(720, 575);
        setTimeout(function() {
            if (document.querySelector('.header-video').offsetLeft !== 0) {
                el.attr('style', 'left: 0px');
            }
        }, 30);
    };

    var init = function init() {
        if ($('.homepage-layout').length) {
            video();
            window.onresize = function() {
                video();
            };

            if ($('#map').length) {
                window.init_maps = maps.init;
                maps.create();
            }
        }
    };

    return {
        init: init
    };
});
