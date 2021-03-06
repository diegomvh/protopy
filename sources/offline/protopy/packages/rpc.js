/*
 * JSON/XML-RPC Client <http://code.google.com/p/json-xml-rpc/>
 * Version: 0.8.0.2 (2007-12-06)
 * Copyright: 2007, Weston Ruter <http://weston.ruter.net/>
 * License: GNU General Public License, Free Software Foundation
 *          <http://creativecommons.org/licenses/GPL/2.0/>
 *
 * Original inspiration for the design of this implementation is from jsolait, from which 
 * are taken the "ServiceProxy" name and the interface for synchronous method calls.
 * 
 * See the following specifications:
 *   - XML-RPC: <http://www.xmlrpc.com/spec>
 *   - JSON-RPC 1.0: <http://json-rpc.org/wiki/specification>
 *   - JSON-RPC 1.1 (draft): <http://json-rpc.org/wd/JSON-RPC-1-1-WD-20060807.html>
 *
 * Usage:
 * var service = new rpc.ServiceProxy("/app/service", {
 *                         asynchronous: true,   //default: true
 *                         sanitize: true,       //default: true
 *                         methods: ['greet'],   //default: null (synchronous introspection populates)
 *                         protocol: 'JSON-RPC', //default: JSON-RPC
 * }); 
 * service.greet({
 *    params:{name:"World"},
 *    onSuccess:function(message){
 *        alert(message);
 *    },
 *    onException:function(e){
 *        alert("Unable to greet because: " + e);
 *        return true;
 *    }
 * });
 *
 * If you create the service proxy with asynchronous set to false you may execute
 * the previous as follows:
 *
 * try {
 *    var message = service.greet("World");
 *    alert(message);
 * }
 * catch(e){
 *    alert("Unable to greet because: " + e);
 * }
 *
 * Finally, if the URL provided is on a site that violates the same origin policy,
 * then you may only create an asynchronous proxy, the resultant data may not be
 * sanitized, and you must provide the methods yourself. In order to obtain the
 * method response, the JSON-RPC server must be provided the name of a callback
 * function which will be generated in the JavaScript (json-in-script) response. The HTTP GET
 * parameter for passing the callback function is currently non-standardized and so
 * varies from server to server. Create a service proxy with the option
 * 'callbackParamName' in order to specify the callback function name parameter;
 * the default is 'JSON-response-callback', as used by associated JSON/XML-RPC
 * Server project. For example, getting Google Calendar data:
 *
 * var gcalService = new rpc.ServiceProxy("http://www.google.com/calendar/feeds/myemail%40gmail.com/public", {
 *                         asynchronous: true,  //true (default) required, otherwise error raised
 *                         sanitize: false,     //explicit false required, otherwise error raised
 *                         methods: ['full']    //explicit list required, otherwise error raised
 *                         callbackParamName: 'callback'
 *                         }); 
 * gcalService.full({
 *      params:{
 *          alt:'json-in-script' //required for this to work
 *          'start-min':new Date() //automatically converted to ISO8601
 *          //other Google Calendar parameters
 *      },
 *      onSuccess:function(json){
 *          json.feed.entry.each(function(entry){
 *              //do something
 *          });
 *      }
 * });
 */

require('ajax', 'toQueryString');
require('json');

var rpc = {
    version:"0.8.0.2",	
    requestCount: 0
};

rpc.ServiceProxy = type('ServiceProxy', [ object ], {
    __init__: function(serviceURL, options) {
        this.__serviceURL = serviceURL;

        //Determine if accessing the server would violate the same origin policy
        this.__isCrossSite = false;
        var urlParts = this.__serviceURL.match(/^(\w+:)\/\/([^\/]+?)(?::(\d+))?(?:$|\/)/);
        if(urlParts){
        this.__isCrossSite = (
            location.protocol !=  urlParts[1] ||
            document.domain   !=  urlParts[2] ||
                location.port     != (urlParts[3] || "")
        );
        }
        
        //Set other default options
        var providedMethodList;
        this.__isAsynchronous = true;
        this.__isResponseSanitized = true;
        this.__authUsername = null;
        this.__authPassword = null;
        this.__callbackParamName = 'JSON-response-callback';
        this.__protocol = 'JSON-RPC';
        
        //Get the provided options
        if(options instanceof Object){
            if(options.asynchronous !== undefined){
                this.__isAsynchronous = !!options.asynchronous;
                if(!this.__isAsynchronous && this.__isCrossSite)
                    throw Error("It is not possible to establish a synchronous connection to a cross-site RPC service.");
            }
            if(options.sanitize != undefined)
                this.__isResponseSanitized = !!options.sanitize;
            if(options.user != undefined)
                this.__authUsername = options.user;
            if(options.password != undefined)
                this.__authPassword = options.password;
            if(options.callbackParamName != undefined)
                this.__callbackParamName = options.callbackParamName;
            if(String(options.protocol).toUpperCase() == 'XML-RPC')
                this.__protocol = 'XML-RPC';
            if(options.dateEncoding != undefined)
                this.__dateEncoding = options.dateEncoding;
            providedMethodList = options.methods;
        }
        if(this.__isCrossSite){
            if(this.__isResponseSanitized){
                throw Error("You are attempting to access a service on another site, and the JSON data returned " +
                            "by cross-site requests cannot be sanitized. You must therefore explicitly set the " +
                            "'sanitize' option to false (it is true by default) in order to proceed with making " +
                            "potentially insecure cross-site rpc calls.");
            }
            else if(this.__protocol == 'XML-RPC')
                throw Error("Unable to use the XML-RPC protocol to access services on other domains.");
        }
        
        //Obtain the list of methods made available by the server
        if(this.__isCrossSite && !providedMethodList)
            throw Error("You must manually supply the service's method names since auto-introspection is not permitted for cross-site services.");
        if(providedMethodList)
            this.__methodList = providedMethodList;
        else {
            //Introspection must be performed synchronously
            var async = this.__isAsynchronous;
            this.__isAsynchronous = false;
            this.__methodList = this.__callMethod("system.listMethods", []);
            this.__isAsynchronous = async;
        }
        this.__methodList.push('system.listMethods');
        this.__methodList.push('system.describe');
        
        //Create local "wrapper" functions which reference the methods obtained above
        for(var methodName, i = 0; methodName = this.__methodList[i]; i++){
            //Make available the received methods in the form of chained property lists (eg. "parent.child.methodName")
            var methodObject = this;
            var propChain = methodName.split(/\./);
            for(var j = 0; j+1 < propChain.length; j++){
                if(!methodObject[propChain[j]])
                    methodObject[propChain[j]] = {};
                methodObject = methodObject[propChain[j]];
            }
    
            //Create a wrapper to this.__callMethod with this instance and this methodName bound
            var wrapper = (function(instance, methodName){
                var call = {instance:instance, methodName:methodName}; //Pass parameters into closure
                return function(){
                    if(call.instance.__isAsynchronous){
                        if(arguments.length == 1 && arguments[0] instanceof Object){
                            call.instance.__callMethod(call.methodName,
                                                    arguments[0].params,
                                                    arguments[0].onSuccess,
                                                    arguments[0].onException,
                                                    arguments[0].onComplete);
                        }
                        else {
                            call.instance.__callMethod(call.methodName,
                                                    arguments[0],
                                                    arguments[1],
                                                    arguments[2],
                                                    arguments[3]);
                        }	
                        return undefined;
                    }
                    else return call.instance.__callMethod(call.methodName, array(arguments));
                };
            })(this, methodName);
            
            methodObject[propChain[propChain.length-1]] = wrapper;
        }
    },

    __callMethod: function(methodName, params, successHandler, exceptionHandler, completeHandler){
        rpc.requestCount++;

        //Verify that successHandler, exceptionHandler, and completeHandler are functions
        if(this.__isAsynchronous){
            if(successHandler && typeof successHandler != 'function')
                throw Error('The asynchronous onSuccess handler callback function you provided is invalid; the value you provided (' + successHandler.toString() + ') is of type "' + typeof(successHandler) + '".');
            if(exceptionHandler && typeof exceptionHandler != 'function')
                throw Error('The asynchronous onException handler callback function you provided is invalid; the value you provided (' + exceptionHandler.toString() + ') is of type "' + typeof(exceptionHandler) + '".');
            if(completeHandler && typeof completeHandler != 'function')
                throw Error('The asynchronous onComplete handler callback function you provided is invalid; the value you provided (' + completeHandler.toString() + ') is of type "' + typeof(completeHandler) + '".');
        }	
    
        try {
            //Assign the provided callback function to the response lookup table
            if(this.__isAsynchronous || this.__isCrossSite){
                rpc.pendingRequests[String(rpc.requestCount)] = {
                    //method:methodName,
                    onSuccess:successHandler,
                    onException:exceptionHandler,
                    onComplete:completeHandler
                };
            }
                
            //Asynchronous cross-domain call (JSON-in-Script) -----------------------------------------------------
            if(this.__isCrossSite){ //then this.__isAsynchronous is implied
                
                //Create an ad hoc function specifically for this cross-site request; this is necessary because it is 
                //  not possible pass an JSON-RPC request object with an id over HTTP Get requests.
                rpc.callbacks['r' + String(rpc.requestCount)] = (function(instance, id){
                    var call = {instance: instance, id: id}; //Pass parameter into closure
                    return function(response){
                        if(response instanceof Object && (response.result || response.error)){
                            response.id = call.id;
                            instance.__doCallback(response);
                        }
                        else {//Allow data without response wrapper (i.e. GData)
                            instance.__doCallback({id: call.id, result: response});
                        }
                    }
                })(this, rpc.requestCount);
                //rpc.callbacks['r' + String(rpc.requestCount)] = new Function("response", 'response.id = ' + rpc.requestCount + '; this.__doCallback(response);');
                
                //Make the request by adding a SCRIPT element to the page
                var script = document.createElement('script');
                script.setAttribute('type', 'text/javascript');
                var src = this.__serviceURL +
                            '/' + methodName +
                            '?' + this.__callbackParamName + '=rpc.callbacks.r' + (rpc.requestCount);
                if(params)
                    src += '&' + toQueryString(params);
                script.setAttribute('src', src);
                script.setAttribute('id', 'rpc' + rpc.requestCount);
                var head = document.getElementsByTagName('head')[0];
                rpc.pendingRequests[rpc.requestCount].scriptElement = script;
                head.appendChild(script);
                
                return undefined;
            }
            //Calls made with XMLHttpRequest ------------------------------------------------------------
            else {
                //Obtain and verify the parameters
                if(params){
                    if(!(params instanceof Object) || params instanceof Date) //JSON-RPC 1.1 allows params to be a hash not just an array
                        throw Error('When making asynchronous calls, the parameters for the method must be passed as an array (or a hash); the value you supplied (' + String(params) + ') is of type "' + typeof(params) + '".');
                    //request.params = params;
                }
                
                //Prepare the XML-RPC request
                var request,postData;
                if(this.__protocol == 'XML-RPC'){
                    if(!(params instanceof Array))
                        throw Error("Unable to pass associative arrays to XML-RPC services.");
                    
                    var xml = ['<?xml version="1.0"?><methodCall><methodName>' + methodName + '</methodName>'];
                    if(params){
                        xml.push('<params>');
                        for(var i = 0; i < params.length; i++)
                            xml.push('<param>' + this.__toXMLRPC(params[i]) + '</param>');
                        xml.push('</params>');
                    }
                    xml.push('</methodCall>');
                    postData = xml.join('');
                }
                //Prepare the JSON-RPC request
                else {
                    request = {
                        version:"1.1",
                        method:methodName,
                        id:rpc.requestCount
                    };
                    if(params)
                        request.params = params;
                    postData = json.stringify(request);
                }
                
                //XMLHttpRequest chosen (over Ajax.Request) because it propogates uncaught exceptions
                var xhr;
                if(window.XMLHttpRequest)
                    xhr = new XMLHttpRequest();
                else if(window.ActiveXObject){
                    try {
                        xhr = new ActiveXObject('Msxml2.XMLHTTP');
                    } catch(err){
                        xhr = new ActiveXObject('Microsoft.XMLHTTP');
                    }
                }
                xhr.open('POST', this.__serviceURL, this.__isAsynchronous, this.__authUsername, this.__authPassword);
                if(this.__protocol == 'XML-RPC'){
                    xhr.setRequestHeader('Content-Type', 'text/xml');
                    xhr.setRequestHeader('Accept', 'text/xml');
                }
                else {
                    xhr.setRequestHeader('Content-Type', 'application/json');
                    xhr.setRequestHeader('Accept', 'application/json');
                }
                
                //Asynchronous same-domain call -----------------------------------------------------
                if(this.__isAsynchronous){
                    //Send the request
                    xhr.send(postData);
                    
                    //Handle the response
                    var instance = this;
                    var requestInfo = {id:rpc.requestCount}; //for XML-RPC since the 'request' object cannot contain request ID
                    xhr.onreadystatechange = function(){
                        //QUESTION: Why can't I use this.readyState?
                        if(xhr.readyState == 4){
                            //XML-RPC
                            if(instance.__protocol == 'XML-RPC'){
                                var response = instance.__getXMLRPCResponse(xhr, requestInfo.id);
                                instance.__doCallback(response);
                            }
                            //JSON-RPC
                            else {
                                var response = json.parse(xhr.responseText, instance.__isResponseSanitized);
                                if(!response.id)
                                    response.id = requestInfo.id;
                                instance.__doCallback(response);
                            }
                        }
                    };
                    
                    return undefined;
                }
                //Synchronous same-domain call -----------------------------------------------------
                else {
                    //Send the request
                    xhr.send(postData);
                    var response;
                    if(this.__protocol == 'XML-RPC')
                        response = this.__getXMLRPCResponse(xhr, rpc.requestCount);
                    else
                        response = json.parse(xhr.responseText, this.__isResponseSanitized);
                    
                    //Note that this error must be caught with a try/catch block instead of by passing a onException callback
                    if(response.error) {
                    	var err = new Error('Unable to call "' + methodName + '". Server responsed with error (code ' + response.error.code + '): ' + response.error.message);
                        err.code = response.error.code;
                        throw err;
                    }
                    
                    return response.result;
                }
            }
        }
        catch(err){
            //err.locationCode = PRE-REQUEST Cleint
            var isCaught = false;
            if(exceptionHandler)
                isCaught = exceptionHandler(err); //add error location
            if(completeHandler)
                completeHandler();
                
            if(!isCaught)
                throw err;
        }
    },

    //Called by asychronous calls when their responses have loaded
    __doCallback: function(response){
        if(typeof response != 'object')
            throw Error('The server did not respond with a response object.');
        if(!response.id)
            throw Error('The server did not respond with the required response id for asynchronous calls.');
    
        if(!rpc.pendingRequests[response.id])
            throw Error('Fatal error with RPC code: no ID "' + response.id + '" found in pendingRequests.');
        
        //Remove the SCRIPT element from the DOM tree for cross-site (JSON-in-Script) requests
        if(rpc.pendingRequests[response.id].scriptElement){
            var script = rpc.pendingRequests[response.id].scriptElement;
            script.parentNode.removeChild(script);
        }
        //Remove the ad hoc cross-site callback function
        if(rpc.callbacks[response.id])
            delete rpc.callbacks['r' + response.id];
        
        var uncaughtExceptions = [];
        
        //Handle errors returned by the server
        if(response.error !== undefined){
            var err = new Error(response.error.message);
            err.code = response.error.code;
            //err.locationCode = SERVER
            if(rpc.pendingRequests[response.id].onException){
                try{
                    if(!rpc.pendingRequests[response.id].onException(err))
                        uncaughtExceptions.push(err);
                }
                catch(err2){ //If the onException handler also fails
                    uncaughtExceptions.push(err);
                    uncaughtExceptions.push(err2);
                }
            }
            else uncaughtExceptions.push(err);
        }
        
        //Process the valid result
        else if(response.result !== undefined){
            //iterate over all values and substitute date strings with Date objects
            //Note that response.result is not passed because the values contained
            //  need to be modified by reference, and the only way to do so is
            //  but accessing an object's properties. Thus an extra level of
            //  abstraction allows for accessing all of the results members by reference.
            
            if(rpc.pendingRequests[response.id].onSuccess){
                try {
                    rpc.pendingRequests[response.id].onSuccess(response.result);
                }
                //If the onSuccess callback itself fails, then call the onException handler as above
                catch(err){
                    //err3.locationCode = CLIENT;
                    if(rpc.pendingRequests[response.id].onException){
                        try {
                            if(!rpc.pendingRequests[response.id].onException(err))
                                uncaughtExceptions.push(err);
                        }
                        catch(err2){ //If the onException handler also fails
                            uncaughtExceptions.push(err);
                            uncaughtExceptions.push(err2);
                        }
                    }
                    else uncaughtExceptions.push(err);
                }
            }
        }
        
        //Call the onComplete handler
        try {
            if(rpc.pendingRequests[response.id].onComplete)
                rpc.pendingRequests[response.id].onComplete(response);
        }
        catch(err){ //If the onComplete handler fails
            //err3.locationCode = CLIENT;
            if(rpc.pendingRequests[response.id].onException){
                try {
                    if(!rpc.pendingRequests[response.id].onException(err))
                        uncaughtExceptions.push(err);
                }
                catch(err2){ //If the onException handler also fails
                    uncaughtExceptions.push(err);
                    uncaughtExceptions.push(err2);
                }
            }
            else uncaughtExceptions.push(err);
        }
        
        delete rpc.pendingRequests[response.id];
        
        //Merge any exception raised by onComplete into the previous one(s) and throw it
        if(uncaughtExceptions.length){
            var code;
            var message = 'There ' + (uncaughtExceptions.length == 1 ?
                                'was 1 uncaught exception' :
                                'were ' + uncaughtExceptions.length + ' uncaught exceptions') + ': ';
            for(var i = 0; i < uncaughtExceptions.length; i++){
                if(i)
                    message += "; ";
                message += uncaughtExceptions[i].message;
                if(uncaughtExceptions[i].code)
                    code = uncaughtExceptions[i].code;
            }
            var err = new Error(message);
            err.code = code;	
            throw err;
        }
    },

    /*******************************************************************************************
    * XML-RPC Specific Functions
    ******************************************************************************************/

    __toXMLRPC: function(value){
        var xml = ['<value>'];
        switch(typeof value){
            case 'number':
                if(!isFinite(value))
                    xml.push('<nil/>');
                else if(parseInt(value) == Math.ceil(value)){
                    xml.push('<int>');
                    xml.push(value.toString());
                    xml.push('</int>');
                }
                else {
                    xml.push('<double>');
                    xml.push(value.toString());
                    xml.push('</double>');
                }
                break;
            case 'boolean':
                xml.push('<boolean>');
                xml.push(value ? '1' : '0');
                xml.push('</boolean>');
                break;
            case 'string':
                xml.push('<string>');
                xml.push(value.replace(/[<>&]/, function(ch){
                    
                })); //escape for XML!
                xml.push('</string>');
                break;
            case 'object':
                if(value === null)
                    xml.push('<nil/>');
                else if(value instanceof Array){
                    xml.push('<array><data>');
                    for(var i = 0; i < value.length; i++)
                        xml.push(this.__toXMLRPC(value[i]));
                    xml.push('</data></array>');
                }
                else if(value instanceof Date){
                    xml.push('<dateTime.iso8601>' + value.toISO8601() + '</dateTime.iso8601>');
                }
                else if(value instanceof Number || value instanceof String || value instanceof Boolean)
                    return value.valueOf().toISO8601();
                else {
                    xml.push('<struct>');
                    var useHasOwn = {}.hasOwnProperty ? true : false; //From Ext's JSON.js
                    for(var key in value){
                        if(!useHasOwn || value.hasOwnProperty(key)){
                            xml.push('<member>');
                            xml.push('<name>' + key + '</name>'); //Excape XML!
                            xml.push(this.__toXMLRPC(value[key]));
                            xml.push('</member>');
                        }
                    }
                    xml.push('</struct>');
                }
                break;
            //case 'undefined':
            //case 'function':
            //case 'unknown':
            default:
                throw new TypeError('Unable to convert the value of type "' + typeof(value) + '" to XML-RPC.'); //(' + String(value) + ')
        }
        xml.push('</value>');
        return xml.join('');
        },
    
        __parseXMLRPC: function(valueEl) {
        if(valueEl.childNodes.length == 1 &&
        valueEl.childNodes.item(0).nodeType == 3)
        {
            return valueEl.childNodes.item(0).nodeValue;
        }
        for(var i = 0; i < valueEl.childNodes.length; i++){
            if(valueEl.childNodes.item(i).nodeType == 1){
                var typeEL = valueEl.childNodes.item(i);
                switch(typeEL.nodeName.toLowerCase()){
                    case 'i4':
                    case 'int':
                        //An integer is a 32-bit signed number. You can include a plus or minus at the
                        //   beginning of a string of numeric characters. Leading zeros are collapsed.
                        //   Whitespace is not permitted. Just numeric characters preceeded by a plus or minus.
                        var intVal = parseInt(typeEL.firstChild.nodeValue);
                        if(isNaN(intVal))
                            throw Error("XML-RPC Parse Error: The value provided as an integer '" + typeEL.firstChild.nodeValue + "' is invalid.");
                        return intVal;
                    case 'double':
                        //There is no representation for infinity or negative infinity or "not a number".
                        //   At this time, only decimal point notation is allowed, a plus or a minus,
                        //   followed by any number of numeric characters, followed by a period and any
                        //   number of numeric characters. Whitespace is not allowed. The range of
                        //   allowable values is implementation-dependent, is not specified.
                        var floatVal = parseFloat(typeEL.firstChild.nodeValue);
                        if(isNaN(floatVal))
                            throw Error("XML-RPC Parse Error: The value provided as a double '" + typeEL.firstChild.nodeValue + "' is invalid.");
                        return floatVal;
                    case 'boolean':
                        if(typeEL.firstChild.nodeValue != '0' && typeEL.firstChild.nodeValue != '1')
                            throw Error("XML-RPC Parse Error: The value provided as a boolean '" + typeEL.firstChild.nodeValue + "' is invalid.");
                        return Boolean(parseInt(typeEL.firstChild.nodeValue));
                    case 'string':
                        if(!typeEL.firstChild)
                            return "";
                        return typeEL.firstChild.nodeValue;
                    case 'datetime.iso8601':
                        var matches, date = new Date(0);
                        if(matches = typeEL.firstChild.nodeValue.match(/^(?:(\d\d\d\d)-(\d\d)(?:-(\d\d)(?:T(\d\d)(?::(\d\d)(?::(\d\d)(?:\.(\d+))?)?)?)?)?)$/)){
                            if(matches[1]) date.setUTCFullYear(parseInt(matches[1]));
                            if(matches[2]) date.setUTCMonth(parseInt(matches[2]-1));
                            if(matches[3]) date.setUTCDate(parseInt(matches[3]));
                            if(matches[4]) date.setUTCHours(parseInt(matches[4]));
                            if(matches[5]) date.setUTCMinutes(parseInt(matches[5]));
                            if(matches[6]) date.setUTCMilliseconds(parseInt(matches[6]));
                            return date;
                        }
                        throw Error("XML-RPC Parse Error: The provided value does not match ISO8601.");
                    case 'base64':
                        throw Error("Not able to parse base64 data yet.");
                        //return base64_decode(typeEL.firstChild.nodeValue);
                    case 'nil':
                        return null;
                    case 'struct':
                        //A <struct> contains <member>s and each <member> contains a <name> and a <value>.
                        var obj = {};
                        for(var memberEl, j = 0; memberEl = typeEL.childNodes.item(j); j++){
                            if(memberEl.nodeType == 1 && memberEl.nodeName == 'member'){
                                var name = '';
                                valueEl = null;
                                for(var child, k = 0; child = memberEl.childNodes.item(k); k++){
                                    if(child.nodeType == 1){
                                        if(child.nodeName == 'name')
                                            name = child.firstChild.nodeValue;
                                        else if(child.nodeName == 'value')
                                            valueEl = child;
                                    }
                                }
                                //<struct>s can be recursive, any <value> may contain a <struct> or
                                //   any other type, including an <array>, described below.
                                if(name && valueEl)
                                    obj[name] = this.__parseXMLRPC(valueEl);
                            }
                        }
                        return obj;
                    case 'array':
                        //An <array> contains a single <data> element, which can contain any number of <value>s.
                        var arr = [];
                        var dataEl = typeEL.firstChild;
                        while(dataEl && (dataEl.nodeType != 1 || dataEl.nodeName != 'data'))
                            dataEl = dataEl.nextSibling;
                        
                        if(!dataEl)
                            new Error("XML-RPC Parse Error: Expected 'data' element as sole child element of 'array'.");
                        
                        valueEl = dataEl.firstChild;
                        while(valueEl){
                            if(valueEl.nodeType == 1){
                                //<arrays>s can be recursive, any value may contain an <array> or
                                //   any other type, including a <struct>, described above.
                                if(valueEl.nodeName == 'value')
                                    arr.push(this.__parseXMLRPC(valueEl));
                                else
                                    throw Error("XML-RPC Parse Error: Illegal element child '" + valueEl.nodeName + "' of an array's 'data' element.");
                            }
                            valueEl = valueEl.nextSibling;
                        }
                        return arr;
                    default:
                        throw Error("XML-RPC Parse Error: Illegal element '" + typeEL.nodeName + "' child of the 'value' element.");
                }
            }
        }
        return '';
    },

    __getXMLRPCResponse: function(xhr, id){
        var response = {};
        if(!xhr.responseXML)
            throw Error("Malformed XML document.");
        var doc = xhr.responseXML.documentElement;
        if(doc.nodeName != 'methodResponse')
            throw Error("Invalid XML-RPC document.");
        
        var valueEl = doc.getElementsByTagName('value')[0];
        if(valueEl.parentNode.nodeName == 'param' &&
        valueEl.parentNode.parentNode.nodeName == 'params')
        {
            response.result = this.__parseXMLRPC(valueEl);
        }
        else if(valueEl.parentNode.nodeName == 'fault'){
            var fault = this.__parseXMLRPC(valueEl);
            response.error = {
                code: fault.faultCode,
                message: fault.faultString
            };
        }
        else throw Error("Invalid XML-RPC document.");
        
        if(!response.result && !response.error)
            throw Error("Malformed XML-RPC methodResponse document.");
        
        response.id = id; //XML-RPC cannot pass and return request IDs
        return response;
    }
});

rpc.setAsynchronous = function(serviceProxy, isAsynchronous){
    if(!isAsynchronous && serviceProxy.__isCrossSite)
        throw Error("It is not possible to establish a synchronous connection to a cross-site RPC service.");
    serviceProxy.__isAsynchronous = !!isAsynchronous;
};



//This acts as a lookup table for the response callback to execute the user-defined
//   callbacks and to clean up after a request
rpc.pendingRequests = {};

//Ad hoc cross-site callback functions keyed by request ID; when a cross-site request
//   is made, a function is created 
rpc.callbacks = {};

//Generic Error code
rpc.JsonRpcException = 0;

publish(rpc);