;(function() {
    var android = {};

    android.init = function init() {
        if ($('.mdi-navigation-menu').length) {
            $('.button-collapse').sideNav();
        }
    };

    $(android.init);
})();
