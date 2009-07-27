#! /usr/bin/env python
# -*- coding: utf-8 -*-

from django.core.management.base import *
#from offline.models import Manifest
from offline.models import GearsManifest, GearsManifestEntry
from django.db import models 
#TODO: (d3f0)Move away code from
from offline.sites import random_string
from offline.util import get_site, get_site_root, excluding_abswalk_with_simlinks ,\
    full_template_list
from django_extensions.management.utils import get_project_root
import os
import sys
import time
from pprint import pprint

#TODO: Update if changed based on file modification date
class Command(LabelCommand):
    help = \
    """
        This command updates manifest files for remote site sincronization.
    """
    requires_model_validation = False
    can_import_settings = True
    
    option_list = LabelCommand.option_list + (
        make_option('-c', '--clear', action='store_true', dest='clear', default = False,
                    help="Clears application manifests"),
        make_option('-r', '--ver', action='store', dest='version', 
                    help = "Version")                                      
        )
    
    def handle_label(self, remotesite_name, **options):
        from django.conf import settings
        self.site = get_site(remotesite_name)
        if not self.site:
            print "Can't find any site by the name '%s'" % remotesite_name
            # Won't exit if it fails since more than one site maight have been
            # passed to the command
            #sys.exit(3)
            return
        try:
            self.manifest = GearsManifest.objects.get(remotesite_name = remotesite_name)
        except models.exceptions.ObjectDoesNotExist:
            print "No resmote instance"
            self.manifest = GearsManifest()
            self.manifest.remotesite_name = remotesite_name
            
        except (models.exceptions.FieldError, models.exceptions.ValidationError):
            print "Syncdb?"
            return
        
        # Switches
        
        
        if options.get('clear'):
            return self.clear_manifest()
        
        entries = self.manifest.gearsmanifestentry_set.count()
        
        offline_base = self.site.offline_base
        splitted_offline_base = offline_base.split('/')
        # Cambiar el numero de version
        if not self.manifest.version:
            self.manifest.version = random_string(32)
        print self.manifest.version
        
        # Application Code
        file_list = []
        site_root = get_site_root(remotesite_name)
        project_root = get_project_root()
        for f in excluding_abswalk_with_simlinks(site_root):
            pth = f[ f.index(site_root) + len(site_root) + 1: ]
            pth = pth.split(os.sep)
            pth = '/'.join( splitted_offline_base + pth)
            mtime = time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(os.path.getmtime(f)))
            rel_f = os.path.relpath(f, project_root)
            #TODO: Remove base path
            file_list.append({'url': pth, 'file': rel_f, 'file_mtime': mtime, 'file_size': os.path.getsize(f), 'real_file': True})
            
        if not entries:
            # New instance or empty, just create entries and add them
            self.manifest.save()
            for f in file_list:
                entry = GearsManifestEntry(manifest = self.manifest, **f).save()
                print entry
                #entry.save()
            #self.manifest.save()
        else:
            # Compraracion por modificaciones
            print "Comparing file sizes and mtime"
            file_mapping = dict([(m.file, m) for m in self.manifest.gearsmanifestentry_set.all()])
            
        print full_template_list()
        #pprint(locals())
    
    def clear_manifest(self):
        print "Clear manifest...",
        self.manifest.gearsmanifestentry_set.all().delete()
        if not self.manifest.gearsmanifestentry_set.count():
            print "OK"
            
        
    
    def update_manifest(self):
        pass
    
    
    def check_system_manifest(self):
        pass
        #manifest.add_uris_from_pathwalk(path, uri_base, exclude_callback, followlinks)
        #from ipdb import set_trace; set_trace()
        
#        try:
#            m = Manifest.objects.get(remotesite_name = remotesite_name)
#        except Exception, e:
#            print e
#            print "Creating new manifest for %s" % remotesite_name
#            m = Manifest()
        #template_base = self.offline_base.split('/') + ['templates', ] 
        
        # genreate random version string
#        m.version = random_string(32)
        
        #remotesite = 
        
        #m.add_uris_from_pathwalk(path, uri_base, exclude_callback, followlinks)
        
        #m.add_uris_from_pathwalk(self.offline_root, '/%s/project' % self.offline_base)
        # Add templates
        #for t in full_template_list():
        #    m.add_entry( '/%s' % '/'.join( filter(bool, template_base + t.split(os.sep))))
            
        #app_labels = set(map( lambda model: model._meta.app_label, self._registry))
        
        #for app in app_labels:
        #    m.add_entry('/%s/export/%s/models.js' % (self.offline_base, app))
            
        


