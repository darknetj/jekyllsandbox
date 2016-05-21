/* globals define */
define([
    'jquery',
], function($) {
    'use strict';

    var STRIPE_KEY = 'pk_live_XUHLAxnMqdvRrdRCTQ5O3ZmM'
    var donate = {}

    donate.submit = function submit(e) {
        e.preventDefault()
        donate.parse(function(amount) {
            donate.amount = amount;

            // Open Checkout with further options
            donate.handler.open({
                name: 'Stripe.com',
                description: 'donation',
                amount: amount
            });
        });
    }

    donate.parse = function parse(callback) {
        var input = $('#donate input[name=amount]:checked');
        var amount = parseInt(input.val());
        if (amount)
            callback(amount * 100);
        else
            donate.notify('negative', 'Please select ($) amount to donate')
    }

    donate.charge = function charge(donation) {
        $.ajax({
            method: 'POST',
            url: '/api/1.0.0/donations',
            data: JSON.stringify(donation),
            contentType: 'application/json',
            dataType: 'json',
            processData: true
        })
            .done(function(resp) {
                console.log('api response:', resp)
                donate.notify('positive', 'Successfully donated $' + (donate.amount / 100))
            })
            .fail(function(xhr, status, error) {
                console.log('api error:', xhr)
                var list = xhr.responseJSON ? xhr.responseJSON.errors : []
                donate.notify('negative', 'Error donating', list)
            });
    }

    donate.notify = function notify(kind, msg, list) {
        if (list && list.length > 0)
            msg += ': ' + list.join(' ')
        donate.alert
            .removeClass('form-alert--positive')
            .removeClass('form-alert--negative')
            .addClass('form-alert--' + kind)
            .html(msg)
    }

    function init() {
        if ($('#donate').length) {

            $('#donate').submit(donate.submit)
            $('#stripe-submit').on('click', donate.submit)

            console.log('--- Donate init ---');
            donate.alert = $('.form-alert')

            donate.alert
                .removeClass('form-alert--positive')
                .removeClass('form-alert--negative')

            donate.handler = StripeCheckout.configure({
                key: STRIPE_KEY,
                image: '/assets/logo_icon.png',
                locale: 'auto',
                token: function(token) {
                    console.log('got token:', token, 'charging...')
                    donate.charge({
                        email: token.email,
                        amount: donate.amount,
                        token: token.id,
                        processor: 'stripe',
                        page: window.location.pathname
                    })
                }
            })

            // Close Checkout on page navigation
            $(window).on('popstate', function() {
                donate.handler.close();
            });

            var other_input = $('.amount-other-input')
            var other = $('#amount_other')
            other.click(function() {
                other_input.show()
            })

            other_input
                .hide()
                .find('input').on("input", function() {
                    other.val(this.value)
                });

        }
    }

    return {
        init: init
    };
});
