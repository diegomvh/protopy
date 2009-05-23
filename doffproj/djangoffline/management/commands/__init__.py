
# Some common code 

def offline_setup_checks():
    '''
    Checks basic setup has been made
    '''
    import sys
    from django.conf import settings
    from os.path import isabs, abspath, exists
    
    if not hasattr(settings, 'OFFLINE_ROOT'):
        print _("You must define settings.OFFLINE_ROOT in order to enable project offlinization")
        sys.exit(2)
          
    df_path = abspath(settings.OFFLINE_ROOT)
    if not isabs(df_path):
        print _("%s doesn't seem to be an absolute path, please correct this in your project's settings.py")
        sys.exit(3)




def get_app_path(app_name):
    # Returns application root in filesystem
    from django.db.models.loading import get_app
    from os.path import dirname, abspath
    app = get_app(app_name)
    return abspath(dirname(app.__file__))

def get_doffline_path():
    # Convenience function
    return get_app_path('djangoffline')


    
    