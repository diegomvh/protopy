# -*- encoding: utf-8 -*-

from django.conf import settings
from django.utils.translation import gettext_lazy as _
from django.db.models import get_app, get_apps, get_model, get_models
from django.core.exceptions import ImproperlyConfigured
from django.http import HttpResponse
from django.utils.html import escape
import inspect
from pprint import pformat
from remotemodels import RemoteModelProxy
import os
 
def create_system_manifest(request):
    version = None

def create_project_manifest(request):
    version = None


def conditional_import(name, f):
    e = []
    mod = __import__(name)
    components = name.split('.')
    for comp in components[1:]:
        mod = getattr(mod, comp)
    for v in mod.__dict__.itervalues():
        if (f(v)):
            e.append(v)
    return e


def export_model_proxy(request):
    assert hasattr(settings, 'OFFLINE_APPS'), _('You must add OFFLINE_APPS to settings.')
    apps = []
    
    for offline_app_str in settings.OFFLINE_APPS:
        try:
            prj_name, app_label = offline_app_str.split('.')
            app = get_app( app_label )
            models = get_models( app )
            models_dict = dict(map( lambda mod: (mod.__name__, mod), models ))
            mod_name = app.__name__.replace('.models', '.remotemodels')
            print "*" * 40
            print mod_name
            print "*" * 40
            proxys = conditional_import(mod_name, lambda x: inspect.isclass(x) and RemoteModelProxy in inspect.getmro(x))
            
                
        except ValueError:
            raise Exception(_("%s can't be found as an app. You should inlude them as PROJETC_NAME(dot)APP_LABEL") % offline_app_str)
        except ImproperlyConfigured:
            raise Exception(_("%s is included as an offlineapp but it doesn't seem to be included") % offline_app_str)
        except ImportError, e:
            print e
            raise Exception(_("%s has no remotemodels, please crete a remotemodels.py in %s folder") % 
                                (offline_app_str, offline_app_str.replace('.', '/')))
    
    return HttpResponse('<pre>%s</pre>' % escape( pformat(models_dict) ))
    


def list_templates(request):
    def valid_templates(name):
        ''' Name validation '''
        return not name.endswith('~')
    
    
    template_files = []
    for tmpl_pth in settings.TEMPLATE_DIRS:
        for root, dirs, files in os.walk(tmpl_pth):
            template_files += files
    template_files = filter(valid_templates, template_files)
    return HttpResponse( '\n'.join(template_files) )
