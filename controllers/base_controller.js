/*
    Copyright (C) 2015  PencilBlue, LLC

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program.  If not, see <http://www.gnu.org/licenses/>.
*/

//dependencies 
var url       = require('url');
var Sanitizer = require('sanitize-html');
var util      = require('../include/util.js');

module.exports = function BaseControllerModule(pb) {

    // pb dependancies
    var SiteService = pb.SiteService;

    /**
     * The base controller provides functions for the majority of
     * the heavy lifing for a controller. It accepts and provides access to
     * extending controllers for items such as the request, response, session, etc.
     * @class BaseController
     * @constructor
     */
    function BaseController(){};

    //constants
    /**
     * The code for a successful API call
     * @static
     * @property API_SUCCESS
     * @type {Integer}
     */
    BaseController.API_SUCCESS = 0;

    /**
     * The code for a failed API call
     * @static
     * @property API_FAILURE
     * @type {Integer}
     */
    BaseController.API_FAILURE = 1;

    /**
     * The snippet of JS code that will ensure that a form is refilled with values
     * from the post
     * @static
     * @private
     * @property FORM_REFILL_PATTERN
     * @type {String}
     */
    var FORM_REFILL_PATTERN = 'if(typeof refillForm !== "undefined") {' + "\n" +
        '$(document).ready(function(){'+ "\n" +
            'refillForm(%s)});}';

    /**
     * The snippet of HTML that will display an alert box
     * @static
     * @private
     * @property ALERT_PATTERN
     * @type {String}
     */
    var ALERT_PATTERN = '<div class="alert %s error_success">%s<button type="button" class="close" data-dismiss="alert" aria-hidden="true">&times;</button></div>';

    /**
     * The prefix in the content-type header that indicates the charset used in 
     * the encoding
     * @static
     * @private
     * @readonly
     * @property CHARSET_HEADER_PREFIX
     * @type {String}
     */
    var CHARSET_HEADER_PREFIX = 'charset=';
    
    /**
     * A mapping that converts the HTTP standard for content-type encoding and 
     * what the Buffer prototype expects
     * @static
     * @private
     * @readonly
     * @property ENCODING_MAPPING
     * @type {Object}
     */
    var ENCODING_MAPPING = Object.freeze({
        'UTF-8': 'utf8',
        'US-ASCII': 'ascii',
        'UTF-16LE': 'utf16le'
    });
    
    /**
     * Responsible for initializing a controller.  Properties from the
     * RequestHandler are passed down so that the controller has complete access to
     * a variety of request specified properties.  By default the function transfers the options over to instance variables that can be access during rendering.  In addition, the function sets up the template service along with a set of local flags:
     * <ul>
     * <li>locale - The selected locale for the request (NOTE: this may not match the requested language if not supported)</li>
     * <li>error_success - An alert box if one was registered by the controller</li>
     * <li>page_name - The title of the page</li>
     * <li>localization_script - Includes the localization script so that it can be used client side</li>
     * <li>analytics - Inserts the necessary javascript for analytics providers</li>
     * </ul>
     * @method init
     * @param {Object} props The properties needed to initialize the controller
     *  @param {RequestHandler} props.request_handler
     *  @param {Request} props.request The incoming request
     *  @param {Response} props.response The outgoing response
     *  @param {Object} props.session The session object
     *  @param {Localization} props.localization_service The localization service instance for the request
     *  @param {Object} props.path_vars The path variables associated with the URL for the request
     *  @param {Object} props.query The query string variables associated with the URL for the request
     *  @param {Function} cb A callback that takes a single optional argument: cb(Error)
     */
    BaseController.prototype.init = function(props, cb) {
        var self = this;
        this.reqHandler          = props.request_handler;
        this.req                 = props.request;
        this.res                 = props.response;
        this.session             = props.session;
        this.body                = props.body;
        this.localizationService = props.localization_service;
        this.ls                  = this.localizationService;
        this.pathVars            = props.path_vars;
        this.query               = props.query;
        this.pageName            = '';
        this.site                = props.site;

        var tsOpts = {
            ls: this.localizationService,
            activeTheme: props.activeTheme,
            site: this.site
        };


        this.ts = this.getTemplateService(tsOpts);
        this.ts.registerLocal('locale', this.ls.language);
        this.ts.registerLocal('error_success', function(flag, cb) {
            self.displayErrorOrSuccessCallback(flag, cb);
        });
        this.ts.registerLocal('page_name', function(flag, cb) {
            cb(null, self.getPageName());
        });
        this.ts.registerLocal('localization_script', function(flag, cb) {
            self.requiresClientLocalizationCallback(flag, cb);
        });
        this.ts.registerLocal('analytics', function(flag, cb) {
            pb.AnalyticsManager.onPageRender(self.req, self.session, self.ls, cb);
        });
        this.ts.registerLocal('wysiwyg', function(flag, cb) {
            var wysiwygId = util.uniqueId();

            self.ts.registerLocal('wys_id', wysiwygId);
            self.ts.load('admin/elements/wysiwyg', function(err, data) {
                cb(err, new pb.TemplateValue(data, false));
            });
        });


        /**
         *
         * @property activeTheme
         * @type {String}
         */
        this.activeTheme = props.activeTheme;
        
        //build out a base service context that can be cloned and passed to any 
        //service objects
        this.context = {
            req: this.req,
            session: this.session,
            ls: this.ls,
            ts: this.ts,
            site: this.site,
            activeTheme: this.activeTheme,
            onlyThisSite: true
        };

        var siteService = new SiteService();
        siteService.getByUid(this.site, function (err, siteInfo) {
            if(pb.util.isError(err)) {
                self.reqHandler.serve404();
                return;
            }
            self.siteObj = siteInfo;
            self.siteName = SiteService.isGlobal(siteInfo.uid) ? siteInfo.uid : siteInfo.displayName;

            self.ts.registerLocal('site_root', function(flag, cb) {
                cb(null, SiteService.getHostWithProtocol(self.siteObj.hostname) || self.templateService.siteRoot);
            });
            self.ts.registerLocal('site_name', function(flag, cb) {
                cb(null, self.siteName);
            });
            cb();
        });
    };
    
    /**
     * Retrieves a context object that contains the necessary information for 
     * service prototypes
     * @method getServiceContext
     * @return {Object}
     */
    BaseController.prototype.getServiceContext = function(){
        return util.merge(this.context, {});
    };

    /**
     *
     * @method requiresClientLocalization
     * @return {Boolean}
     */
    BaseController.prototype.requiresClientLocalization = function() {
        return true;
    };

    /**
     * @method getTemplateService
     * @param {Object} options for TemplateService
     * @return {Object} TemplateService
     */
    BaseController.prototype.getTemplateService = function(tsOps) {
        return new pb.TemplateService(tsOps);
    };

    /**
     *
     * @method requiresClientLocalizationCallback
     * @param {String} flag
     * @param {Function} cb
     */
    BaseController.prototype.requiresClientLocalizationCallback = function(flag, cb) {
        var val = '';
        if (this.requiresClientLocalization()) {
            val = pb.ClientJs.includeJS('/api/localization/script');
        }
        cb(null, new pb.TemplateValue(val, false));
    };

    /**
     *
     * @method formError
     * @param {String} message The error message to be displayed
     * @param {String} redirectLocation
     * @param {Function} cb
     */
    BaseController.prototype.formError = function(message, redirectLocation, cb) {

        this.session.error = message;
        cb(pb.RequestHandler.generateRedirect(redirectLocation));
    };

    /**
     *
     * @method displayErrorOrSuccessCallback
     * @param {String} flag
     * @param {Function} cb
     */
    BaseController.prototype.displayErrorOrSuccessCallback = function(flag, cb) {
        if(this.session['error']) {
            var error = this.session['error'];
            delete this.session['error'];
            cb(null, new pb.TemplateValue(util.format(ALERT_PATTERN, 'alert-danger', this.localizationService.get(error)), false));
        }
        else if(this.session['success']) {
            var success = this.session['success'];
            delete this.session['success'];
            cb(null, new pb.TemplateValue(util.format(ALERT_PATTERN, 'alert-success', this.localizationService.get(success)), false));
        }
        else {
            cb(null, '');
        }
    };

    /**
     * Provides a page title.  This is picked up by the template engine when the
     * ^page_name^ key is found in a template.
     * @method getPageName
     * @return {String} The page title
     */
    BaseController.prototype.getPageName = function() {
        return this.pageName;
    };

    /**
     * Sets the page title
     * @method setPageName
     * @param {String} pageName The desired page title
     */
    BaseController.prototype.setPageName = function(pageName) {
        this.pageName = pageName;
    };

    /**
     *
     * @method getPostParams
     * @param {Function} cb
     */
    BaseController.prototype.getPostParams = function(cb) {
        var self = this;
        
        this.getPostData(function(err, raw){
            if (util.isError(err)) {
                cb(err, null);
                return;
            }

            //lookup encoding
            var encoding = pb.BaseBodyParser.getContentEncoding(self.req);
            encoding = ENCODING_MAPPING[encoding] ? ENCODING_MAPPING[encoding] : 'utf8';
            
            //convert to string
            var postParams = url.parse('?' + raw.toString(encoding), true).query;
            cb(null, postParams);
        });
    };

    /**
     * Parses the incoming payload of a request as JSON formatted data.
     * @method getJSONPostParams
     * @param {Function} cb
     */
    BaseController.prototype.getJSONPostParams = function(cb) {
        var self = this;
        
        this.getPostData(function(err, raw){
            if (util.isError(err)) {
                return cb(err, null);
            }
            
            //lookup encoding
            var encoding = pb.BaseBodyParser.getContentEncoding(self.req);
            encoding = ENCODING_MAPPING[encoding] ? ENCODING_MAPPING[encoding] : 'utf8';

            var error      = null;
            var postParams = null;
            try {
                postParams = JSON.parse(raw.toString(encoding));
            }
            catch(err) {
                error = err;
            }
            cb(error, postParams);
        });
    };

    /**
     *
     * @method getPostData
     * @param {Function} cb
     */
    BaseController.prototype.getPostData = function(cb) {
        var buffers     = [];
        var totalLength = 0;
        
        this.req.on('data', function (data) {
            buffers.push(data);
            totalLength += data.length;
            
            // 1e6 === 1 * Math.pow(10, 6) === 1 * 1000000 ~~~ 1MB
            if (totalLength > 1e6) {
                // FLOOD ATTACK OR FAULTY CLIENT, NUKE REQUEST
                cb(new PBError("POST limit reached! Maximum of 1MB.", 400), null);
            }
        });
        this.req.on('end', function () {
            
            //create one big buffer.
            var body = Buffer.concat (buffers, totalLength);
            cb(null, body);
        });
    };

    /**
     *
     * @method hasRequiredParams
     * @param {Object} queryObject
     * @param {Array} requiredParameters
     */
    BaseController.prototype.hasRequiredParams = function(queryObject, requiredParameters) {

        for (var i = 0; i < requiredParameters.length; i++) {

            if (typeof queryObject[requiredParameters[i]] === 'undefined') {
                return this.localizationService.get('FORM_INCOMPLETE');
            }
            else if (queryObject[requiredParameters[i]].length == 0) {
                return this.localizationService.get('FORM_INCOMPLETE');
            }
        }

        if(queryObject['password'] && queryObject['confirm_password']) {
            if(queryObject['password'] != queryObject['confirm_password']) {
                return this.localizationService.get('PASSWORD_MISMATCH');
            }
        }

        return null;
    };

    /**
     *
     * @method setFormFieldValues
     * @param {Object} post
     */
    BaseController.prototype.setFormFieldValues = function(post) {
        this.session.fieldValues = post;
        return this.session;
    };

    /**
     *
     * @method checkForFormRefill
     * @param {String} result
     * @param {Function} cb
     */
    BaseController.prototype.checkForFormRefill = function(result, cb) {
        if(this.session.fieldValues) {
            var content    = util.format(FORM_REFILL_PATTERN, JSON.stringify(this.session.fieldValues));
            var formScript = pb.ClientJs.getJSTag(content);
            result         = result.concat(formScript);

            delete this.session.fieldValues;
        }

        cb(result);
    };

    /**
     * Sanitizes an object.  This function is handy for incoming post objects.  It
     * iterates over each field.  If the field is a string value it will be
     * sanitized based on the default sanitization rules
     * (BaseController.getDefaultSanitizationRules) or those provided by the call
     * to BaseController.getSanitizationRules.
     * @method sanitizeObject
     * @param {Object}
     */
    BaseController.prototype.sanitizeObject = function(obj) {
        if (!util.isObject(obj)) {
            return;
        }

        var rules = this.getSanitizationRules();
        for(var prop in obj) {
            if (util.isString(obj[prop])) {

                var config = rules[prop];
                obj[prop] = BaseController.sanitize(obj[prop], config);
            }
        }
    };

    /**
     *
     * @method getSanitizationRules
     */
    BaseController.prototype.getSanitizationRules = function() {
        return {};
    };

    /**
     * The sanitization rules that apply to Pages and Articles
     * @deprecated Since 0.4.1
     * @static
     * @method getContentSanitizationRules
     */
    BaseController.getContentSanitizationRules = function() {
        return pb.BaseObjectService.getContentSanitizationRules();
    };

    /**
     * @deprecated Since 0.4.1
     * @static
     * @method getDefaultSanitizationRules
     */
    BaseController.getDefaultSanitizationRules = function() {
        return pb.BaseObjectService.getDefaultSanitizationRules();
    };

    /**
     *
     * @deprecated Since 0.4.1
     * @static
     * @method sanitize
     * @param {String} value
     * @param {Object} [config]
     */
    BaseController.sanitize = function(value, config) {
        return pb.BaseObjectService.sanitize(value, config);
    };

    /**
     * Redirects a request to a different location
     * @method redirect
     * @param {String} location
     * @param {Function} cb
     */
    BaseController.prototype.redirect = function(location, cb){
        cb(pb.RequestHandler.generateRedirect(location));
    };

    /**
     * Generates an generic API response object
     * @static
     * @method apiResponse
     * @return {String} JSON
     */
    BaseController.apiResponse = function(cd, msg, dta) {
        if(typeof msg === 'undefined') {
            switch(cd) {
                case BaseController.FAILURE:
                    msg = 'FAILURE';
                    break;
                case BaseController.SUCCESS:
                    msg = 'SUCCESS';
                    break;
                default:
                    msg = '';
                    break;
            }
        }
        if(typeof dta === 'undefined') {
            dta = null;
        }
        var response = {code: cd, message: msg, data: dta};
        return JSON.stringify(response);
    };
    return BaseController;
};
