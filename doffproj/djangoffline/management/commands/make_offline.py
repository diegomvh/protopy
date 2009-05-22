#! /usr/bin/env python
# -*- coding: utf-8 -*-


# make_offline 
# genera el {{ settings.OFFLINE_ROOT }}/offline_{{ PROJECT_NAME }}/settings.js
# {{ settings.OFFLINE_ROOT }}/offline_{{ PROJECT_NAME }}/urls.js
#
#

from django.core.management.base import *
from django.utils.translation import gettext_lazy as _
from os.path import abspath, dirname, isabs, exists, join, basename
from django.db.models.loading import get_app
from django.template import Template, Context
import os
from glob import glob
from djangoffline.management.commands import offline_setup_checks, get_doffline_path

class Command(NoArgsCommand):

    def handle_noargs(self, **options):
        from django.conf import settings

        offline_setup_checks()
        
        offline_root = abspath(settings.OFFLINE_ROOT)
        
        project_name = os.environ.get('DJANGO_SETTINGS_MODULE').replace('.settings', '')
        
        offline_project_root = join(offline_root, '%s_offline' % project_name)
        
        if not exists(offline_project_root):
            print _("Crearing djangoffline project base at %s" % offline_project_root)
            os.mkdir(offline_project_root)
        else:
            print _("Offline project found at: %s" % offline_project_root)
        
        doffline_path = get_doffline_path()
        
#        
#        #else: 
#        elif exists(join(df_path, 'settings.js')):
#            # If the pats exists already, don't touch anything
#            print _("""It seems that an offline project is already set up in %s.
#                        Please remove the directory and rerun to start over.""" % df_path)
#        
#
#
        project_templates = join(doffline_path, 'conf', 'project_template')
        assert exists(project_templates), _("Error with templates")
        
        for fname in glob("%s%s*" % (project_templates, os.sep)):
            f = open(fname, 'r')
            raw_template = f.read()
            f.close()
            template = Template(raw_template)
            context = Context(locals())
            
            base_name = basename(fname)
            dst = join(offline_project_root, base_name)
            f = open(dst, 'w')
            f.write(template.render(context))
            f.close()
            print "%s written" % dst 
        
#        #return NoArgsCommand.handle_noargs(self, **options)

    help = """
        Probando el sistema de comandos de Django.
    """
    requires_model_validation = False
    can_import_settings = True
    