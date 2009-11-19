from salesman.apps.core.models import Categoria, Producto
from django.shortcuts import get_object_or_404, render_to_response
from django.template.context import RequestContext

def productos_por_categoria(request, categoria):
    supercategoria = get_object_or_404(Categoria, id = categoria, super__isnull = True)
    def lista_categorias(super):
        subcategorias = super.categoria_set.all()
        resultado = [super]
        for categoria in subcategorias:
            resultado.extend(lista_categorias(categoria))
        return resultado 
    categorias = lista_categorias(supercategoria)
    categorias = filter(lambda c: c.producto_set.count() > 0, categorias)
    return render_to_response('productos.html', {'categorias': categorias}, context_instance=RequestContext(request))