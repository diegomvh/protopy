require('sys');
require('event');
require('ajax');

var Project = type('Project', object, {
    is_online: null,

    onLoad: function() {

        // Creo el adaptador para el DOM y hago que tome el control de sys.window, sys.document y sys.history
        require('doff.core.client', 'DOMAdapter');
        sys.window = new DOMAdapter();
        sys.document = sys.window.document;
        sys.history = sys.window.history;

        // If settings do this
        this.start_network_thread();
        this.load_splash_screen();
        this.load_toolbar();
        this.start_logging();

        // Inicio del handler para las url
        require('doff.core.handler', 'LocalHandler');
        this.handler = new LocalHandler();

        // Conecto el adaptador al manejador
        event.connect(sys.window, 'send', this.handler, 'receive');
        event.connect(this.handler, 'send', sys.window, 'receive');

        sys.window.location = '/';
    },

    __init__: function(package, project_url) {
        this.package = package;
        this.project_url = project_url;

        this.base_url = string(window.location);
        // Registro la ruta al proyecto
        // desde este momento se puden requerir archivos del proyecto
        sys.register_path(this.package, project_url);
    },

    bootstrap: function() {
        event.connect(window, 'load', this, 'onLoad');
    },

    get_permission: function() {
        if (sys.gears.hasPermission)
            return true;
        var site_name = this.settings.PROJECT_NAME;
        var icon = this.settings.PROJECT_IMAGE;
        var msg = this.settings.PROJECT_DESCRIPTION
            + 'This site would like to use Google Gears to enable fast, '
            + 'as-you-type searching of its documents.';

        return sys.gears.getPermission(site_name, icon, msg);
    },

    get is_installed() {
    	if (!sys.gears.installed || !sys.gears.hasPermission) return false;
        try {
            var localserver = sys.gears.create('beta.localserver');
            return localserver.canServeLocally(this.base_url);
        } catch (e) {
        	return false; 
        }
    },

    get settings() {
    	if (isundefined(this['_settings'])) {
    		require('doff.conf.settings', 'settings');
    		this._settings = settings;
    	}
    	return this._settings;
    },

    /***************************************************************************
     * Installer / Uninstaller
     */
    remove_store: function(callback) {
    	callback = callback || function() {};
        var localserver = sys.gears.create('beta.localserver');
        callback('store', {	'message': 'Destroy store ' + this.package + '_store', 
							'name': this.package + '_store'});
        localserver.removeManagedStore(this.package + '_store');
        this.managed_store = null;
    },
    
    create_store: function(callback) {
    	callback = callback || function() {};
    	var localserver = sys.gears.create('beta.localserver');
    	
    	callback('store', {	'message': 'Create store ' + this.settings.STORE_NAME, 
    						'name': this.settings.STORE_NAME, 
    						'manifest': this.settings.MANIFEST_FILE });
    	this.managed_store = localserver.createManagedStore(this.settings.STORE_NAME);
        this.managed_store.manifestUrl = this.settings.MANIFEST_FILE;

        this.managed_store.oncomplete = function(details) { callback('complete', details); };
        this.managed_store.onerror = function(error) { callback('error', error); };
        this.managed_store.onprogress = function(details) { callback('progress', details); };

        this.managed_store.checkForUpdate();
    },

    install: function(callback) {

        if (!sys.gears.installed) sys.gears.install();
        if (!this.get_permission()) return;

        callback = callback || function() {};
        event.publish('pre_install', [callback]);

        this.create_store(callback);

        require('doff.db.utils','syncdb');
        syncdb(callback);

        this.create_shortcut();
        event.publish('post_install', [callback]);
    },

    uninstall: function(callback) {
        callback = callback || function() {};
        event.publish('pre_uninstall', [callback]);
        require('doff.db.utils','removedb');
        removedb(callback);

        this.remove_store(callback);
        callback('complete', { 'message': 'Project successfuly uninstalled'});
        event.publish('post_uninstall', [callback]);
    },

    /***************************************************************************
     * Toolbar
     */
    load_toolbar: function() {
        require('doff.core.exceptions');
        require('doff.conf.settings', 'settings');
        require('doff.utils.toolbar', 'ToolBar');

        this.toolbar = new ToolBar();

        for each (var toolbar_path in settings.TOOLBAR_CLASSES) {
            var dot = toolbar_path.lastIndexOf('.');
            if (dot == -1)
                throw new exceptions.ImproperlyConfigured('%s isn\'t a toolbar module'.subs(toolbar_path));
            var [ tb_module, tb_classname ] = [ toolbar_path.slice(0, dot), toolbar_path.slice(dot + 1)];
            try {
                var mod = require(tb_module);
            } catch (e if isinstance(e, LoadError)) {
                throw new exceptions.ImproperlyConfigured('Error importing toolbar %s: "%s"'.subs(tb_module, e));
            }
            var tb_class = getattr(mod, tb_classname);
            if (isundefined(tb_class))
                throw new exceptions.ImproperlyConfigured('Toolbar module "%s" does not define a "%s" class'.subs(tb_module, tb_classname));

            var tb_instance = new tb_class(this);
            this.toolbar.add(tb_instance);
        }

        this.toolbar.show();
    },

    /***************************************************************************
     * Create desktop Icon
     */
    create_shortcut: function() {
    	// Ver si esto queda en funcion de algo de la configuracion
    	var desktop = sys.gears.create('beta.desktop');
    	var icon = new desktop.IconTheme('protopy');
    	var sh = new desktop.Shortcut(this.settings.PROJECT_NAME, string(window.location));
    	sh.icon = icon;
    	sh.description = this.settings.PROJECT_DESCRIPTION;
    	sh.save();
    },

    /***************************************************************************
     * Splash Screen
     */
    load_splash_screen: function() {
    	if (this.settings.LOADING_SPLASH) {
    		// Load splash template
    		var template = null;
    		new Request(this.settings.LOADING_SPLASH, {
    			method: 'GET',
    			asynchronous : false,
    			onSuccess: function onSuccess(transport) {
                	template = (transport.responseText);
            }});
    		if (template) {
    			sys.document.update(template);
    			var messages = $('messages');
    			if (messages)
    				var hm = event.subscribe('module_loaded', function(who, module) { messages.update('<strong>' + module.__name__ + '</strong>');});
    		}
    	}
    },

    /***************************************************************************
     * Logging system
     */
    start_logging: function() {
        if (this.settings.LOGGING_CONFIG_FILE) {
            // Inicio el logging, si no hay hay archivo de configuracion no pasa nada
            require('logging.config', 'file_config');
            file_config(sys.module_url(this.package, this.settings.LOGGING_CONFIG_FILE));
        }
    },

    /***************************************************************************
     * Network Check
     */
    network_check: function network_check(){
        var self = this;
        var get = new ajax.Request(this._get_availability_url(), {
            method: 'GET',
            onComplete: function(transport) {
                if (200 == transport.status) {
                    if(!self.is_online || self.is_online == null) {
                        self.is_online = true;
                        event.publish('go_online', [self]);
                   }
                } else if(self.is_online || self.is_online == null) {
                    self.is_online = false;
                    event.publish('go_offline', [self]);
                }
            }
        });
    },

    start_network_thread: function(){
        if (this.settings.NETWORK_CHECK_URL) {
            this.availability_url = this.settings.NETWORK_CHECK_URL;
	    	this.net_check = this.settings.NET_CHECK;
	    	this.thread = window.setInterval(getattr(this, 'network_check'), this.net_check * 1000);
	    }
    },

    stop_network_thread: function(){
        if (this.thread != null) {
            window.clearInterval(this.thread);
            this.thread = null;
        }
    },

    _get_availability_url: function(){
        var url = this.availability_url;
        // bust the browser's cache to make sure we are really talking to the server
        url += (url.indexOf("?") == -1)? "?" : "&";
        url += "browserbust=" + new Date().getTime();
        return url;
    }
});

/**
 * Instancia del proyecto
 */
var project = null;

function get_project(package, project_url){
    if (!package && !project) 
        throw new Exception('No project');
    if (!project) 
        project = new Project(package, project_url);
    return project;
}

publish({
    get_project: get_project,
    new_project: get_project
});