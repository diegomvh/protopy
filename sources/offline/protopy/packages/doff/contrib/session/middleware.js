require('doff.conf.settings', 'settings');
require('doff.contrib.session.models', 'Session');

var SessionMiddleware = type('SessionMiddleware', [ object ], {
    process_request: function(request) {
        var session_key = request.get_cookie(settings.SESSION_COOKIE_NAME);
        request.session = new Session(session_key);
	},
	
    process_response: function(request, response) {
        if (request.session.accessed) {}
        if (request.session.modified) {
            if (request.session.get_expire_at_browser_close()) { //Se pierde con el navegador?
                var max_age = null;
                var expires = null;
            } else {
                var max_age = request.session.get_expiry_age();
                var expires_time = new Date(new Date().getTime() + max_age);
                // Save the session data and refresh the client cookie.
            }
            response.set_cookie(settings.SESSION_COOKIE_NAME,
                	request.session.session_key, max_age,
                    expires_time,
                    path=settings.SESSION_COOKIE_PATH,
                    domain=settings.SESSION_COOKIE_DOMAIN,
                    secure=false);
        }
        return response;
	}
});

publish({
	SessionMiddleware: SessionMiddleware
});