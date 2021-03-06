import random, string
from types import *
from files import *
from models import *
import glob

random_string = lambda length: ''.join( [ random.choice(string.letters) for _ in range(length) ] )

def get_project_name():
    from django.conf import settings
    return settings.ROOT_URLCONF.split('.')[0]

def get_project_root():
    project_mod = __import__(get_project_name(), {}, {}, ['*', ])
    return os.path.dirname(os.path.abspath(project_mod.__file__))

def get_offline_root():
    from django.conf import settings
    return os.path.join(get_project_root(), settings.OFFLINE_BASE)

def get_site_root(site_name):
    if not get_site(site_name):
        return
    return os.path.join(get_offline_root(), site_name)

def get_site(name):
    from django.conf import settings
    from offline import sites
    project_name = settings.ROOT_URLCONF.split('.')[0]
    try:
        __import__('.'.join([project_name, settings.OFFLINE_BASE, "remote_" + name ]), {}, {}, ['*', ])
        return sites.REMOTE_SITES[name]
    except (ImportError, KeyError), e:
        pass 

def get_sites():
    from django.conf import settings
    from offline import sites
    project_name = get_project_name()

    package = __import__('.'.join([project_name, 'offline' ] ), {}, {}, ['*', ])
    path = package.__path__[0]
    sites = []
    for f in glob(path + os.sep + "*.py"):
        name = f.split('/')[-1].split('.')[0]
        site = get_site(name)
        if site:
            sites.append(site)
    return sites

