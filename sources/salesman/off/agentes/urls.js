// Top level offline url-to-view mapping.

require('doff.conf.urls', '*');

var urlpatterns = patterns('',
    ['^/?$', 'doff.views.generic.simple.direct_to_template', {'template': 'orig-index.html'} ],
    ['^catalogo/categoria/(\\d+)/$', 'agentes.core.views.productos_por_categoria'],
    ['^ventas', include('agentes.ventas.urls')]
)

// Don't touch this line
publish({ 
    urlpatterns: urlpatterns 
});
