/* globals define */
define(['jquery'], function($) {
    'use strict';

    var contact = {};

    contact.init = function init() {
        contact.form = $('#contactForm')
        if (contact.form.length) {
            contact.email = contact.form.find('input[name=email]');
            contact.name = contact.form.find('input[name=name]');
            contact.message = contact.form.find('textarea[name=message]');
            contact.alert = contact.form.find('.form-alert');

            contact.form.submit(contact.submit);
        }
    }

    contact.submit = function submit(event) {
        event.preventDefault();
        var data = {
            name: contact.name.val(),
            email: contact.email.val(),
            message: contact.message.val(),
            source: 'contact_form',
            page: window.location.pathname
        };

        if (data.email !== '' ||
            data.message !== '') {

            contact.form.find('input').prop('disabled', true)
            contact.form.find('textarea').prop('disabled', true)

            contact.create(data)
        } else {
            contact.notify('negative', 'Error sending: name, email, and message are required fields.')
        }
    }

    contact.create = function create(data) {
        $.ajax({
            method: 'POST',
            url: '/api/1.0.0/emails',
            data: JSON.stringify(data),
            contentType: 'application/json',
            dataType: 'json',
            processData: true
        })
            .done(function(resp) {
                contact.notify('positive', 'Sent! We\'ll be in touch soon.')
                contact.form.find('input').prop('disabled', false)
                contact.form.find('textarea').prop('disabled', false)
                contact.email.val('')
                contact.name.val('')
                contact.message.val('')
            })
            .fail(function(xhr, status, error) {
                var list = xhr.responseJSON ? xhr.responseJSON.errors : []
                contact.notify('negative', 'Error sending: ', list)
                contact.form.find('input').prop('disabled', false)
                contact.form.find('textarea').prop('disabled', false)
            });
    }

    contact.notify = function alert(kind, msg, list) {
        if (list && list.length > 0)
            msg += ': ' + list.join(' ')
        contact.alert
            .removeClass('form-alert--positive')
            .removeClass('form-alert--negative')
            .addClass('form-alert--' + kind)
            .html(msg)
    }

    return {
        init: contact.init
    };
});
