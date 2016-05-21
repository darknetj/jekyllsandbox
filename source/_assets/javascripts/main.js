require.config({
    paths: {
        jquery: 'vendor/jquery',
        bootstrap: 'vendor/bootstrap',
        covervid: 'vendor/covervid',
        handlebars: 'vendor/handlebars',
    },
     shim: {
        handlebars: {
            exports: 'Handlebars'
        },
    }
});

require(['copperhead'], function(Copperhead) {
    Copperhead.initialize();
});
