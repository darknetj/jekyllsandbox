define(['jquery'], function($) {
    'use strict';

    var cta = {
        init: function() {
            if ($('#cta-email').length === 0)
                return;

            cta.form = $('#cta-email')
            cta.alert = $('.cta-alert')
            cta.email = cta.form.find('input[type=email]')

            cta.form.submit(cta.submit);
        },

        submit: function(event) {
            event.preventDefault();
            cta.alert.removeClass('cta-alert--positive')
            cta.alert.removeClass('cta-alert--negative')
            cta.form.find('input').prop('disabled', true)
            cta.create({
                email: cta.email.val(),
                source: 'email-capture-form',
                page: window.location.pathname
            })
        },

        create: function(user) {
            $.ajax({
                method: 'POST',
                url: '/api/1.0.0/users',
                data: JSON.stringify(user),
                contentType: 'application/json',
                dataType: 'json',
                processData: true
            })
                .done(function(resp) {
                    cta.notify('positive', 'Successfully added ' + user.email + '\
                            to our mailing list')
                    cta.form.find('input').prop('disabled', false)
                    cta.email.val('')
                })
                .fail(function(xhr, status, error) {
                    var list = xhr.responseJSON ? xhr.responseJSON.errors : []
                    cta.notify('negative', 'Error joining list', list)
                    cta.form.find('input').prop('disabled', false)
                });
        },

        notify: function(kind, msg, list)  {
            if (list && list.length > 0)
                msg += ': ' + list.join(' ')
            cta.alert
                .removeClass('cta-alert--positive')
                .removeClass('cta-alert--negative')
                .addClass('cta-alert--' + kind)
                .html(msg)
        }
    }
    return {
        init: cta.init
    };
});
