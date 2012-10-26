var util = require('util');
var request = require('request');
var url = require("url");
var inline = require('./inline.js');
var wufoo_api = require('./wufoo_client/api.js');
var wufoo_admin = require('./wufoo_client/admin.js');
var wufoo_config = require('./wufoo_config.js');
var async = require('async');

function cacheable() {
  // Should page fragments be cached?
  return false;
}

/*
 * Here we rewrite some Wufoo paths to JavaScript and CSS, since they're relative paths
 * rather than absolute ones. We also remove a Wufoo script tag (after form submission)
 * from the HTML, as this JavaScript will already be loaded client side as this point.
 */
updateWufooHTML = function(form_hash, updated, html, remove_script, cb) {
  inline({
    "html": html,
    "baseUrl": "https://" + wufoo_config.wufoo_config.api_domain,
    "removeScripts": remove_script,
    "id": form_hash
  }, function(err, processed_html) {
    if (err != null) {
      console.error('error inlining html:' + err);
    }

    // save processed html to cache
    if (updated) {
      var form_data = JSON.stringify({
        "updated": updated,
        "html": processed_html
      });

      if (cacheable()) {
        $fh.cache({
          act: "save",
          key: form_hash,
          value: form_data
        }, function(err, res) {
          if (err) {
            console.error('Error saving form html to cache :' + err.toString());
          }

          return cb(processed_html);
        });
      } else {
        return cb(processed_html);
      }
    } else {
      return cb(processed_html);
    }
  });
};

formDataToMultipart = function(form_data, cb) {
  var data = form_data;
  var multipart_data = [];

  if (typeof wufoo_config == 'undefined') {
    return callback(null, {
      "html": "",
      "error": "No config."
    });
  }

  // // Password unlock on submit
  // if (typeof wufoo_config.wufoo_config.form_password != 'undefined' && wufoo_config.wufoo_config.form_password) {
  //   var multipart_part = {
  //     'Content-Disposition': 'form-data; name=password"',
  //     body: wufoo_config.wufoo_config.form_password,
  //   }
  //   multipart_data.push(multipart_part);
  // }
  form_data.forEach(function(field) {
    if (field.name != 'output' && typeof field.value != 'undefined') {
      if (field.name == 'clickOrEnter') {
        // clickOrEnter needs to be set to blank or 
        // multi-page forms won't work correctly
        field.value = '';
      }

      if (field.type == 'text' || field.type == 'map' || field.type == 'radio' || field.type == 'checkbox') {
        if (field.value != '') {
          var multipart_part = {
            'Content-Disposition': 'form-data; name="' + field.name + '"',
            body: field.value,
          }
          multipart_data.push(multipart_part);
        }
      } else if (field.type == 'file') {
        if (field.value != '') {
          var multipart_part = {
            'Content-Disposition': 'form-data; name="' + field.name + '"; filename="' + field.filename + '.' + field.extension + '"',
            'Content-Type': 'image/' + field.extension,
            body: new Buffer(field.value, 'base64'),
          }
          multipart_data.push(multipart_part);
        }
      } else {
        console.error('Error, unknown field type: ' + field.type);
      }
    }
  });

  return multipart_data;
};

exports.getForm = function (params, callback) {
  var form_hash = params.form_hash;

  // TODO: generic field validation?
  // TODO: should client handle error as first params? currently sends 500 if error is first param, 200 if second param
  if (form_hash == null) return callback(null, {
    "error": "form_hash is required"
  });

  // asynchronously get:
  // - form data
  // - fields data
  // - rules data
  // and merge together into single json object
  async.parallel([function (cb) {
    wufoo_api.getFormData(form_hash, function (err, body) {
      if (err) return cb(err);

      // TODO: should api client take care of parsing for us?
      try {
        var form_json = JSON.parse(body);
        var form = form_json.Forms[0];
        return cb(null, form);
      } catch (e) {
        return cb({
          "error": e
        });
      }
    });
  },function (cb) {
    wufoo_api.getFormFieldsData(form_hash, function (err, body) {
      if (err) return cb(err);

      // TODO: should api client take care of parsing for us?
      // TODO: should omit special fields on client or cloud? i.e. EntryId, DateCreated, CreatedBy, UpdatedBy, LastUpdated
      try {
        var fields_json = JSON.parse(body);
        return cb(null, fields_json['Fields']);
      } catch (e) {
        return cb({
          "error": e
        });
      }
    });
  }, wufoo_admin.getRules
  ], function (err, results) {
    if (err) return callback(null, err);
    
    var form = results[0];
    form.Fields = results[1];
    form.Rules = results[2];

    return callback(null, {data:form});
  });
};

/* 
 * Here we get a Wufoo form's HTML, process it, and send it back to the client
 */

/* 
 * Here we get a list of available Wufoo forms
 */
exports.getForms = function (params, callback) {
  wufoo_api.getForms(function (error, body) {
    return callback(null, {
      data:JSON.parse(body)
    });
  });
};

/* 
 * Here we get submit a form to Wufoo, and return its
 * proxied response back to the client
 */
exports.submitForm = function(params, callback) {
  var multipart_data = formDataToMultipart(params.form_data);
  var req = request({
    method: 'POST',
    uri: params.form_submission_url,
    followAllRedirects: true,
    headers: {
      'content-type': 'multipart/form-data;'
    },
    multipart: multipart_data
  }, function(e, r, b) {
    updateWufooHTML(params.form_hash, null, b, true, function(processed_html) {
      return callback(null, {
        "html": processed_html + '<button onclick="WufooController.showHome()">Back to Forms</button>'
      });
    });
  });
};