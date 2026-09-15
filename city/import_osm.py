"""Convert downloaded OSM roads/buildings to a local, attributed 3D dataset."""
import json, math
from collections import Counter
from pathlib import Path
ROOT=Path(__file__).parent
raw=json.loads((ROOT/'data/shanghai-api.json').read_text())
allnodes={e['id']:e for e in raw['elements'] if e['type']=='node'}
DRIVABLE={'motorway','trunk','primary','secondary','tertiary','residential','unclassified','living_street','motorway_link','trunk_link','primary_link','secondary_link','tertiary_link'}
ways=[e for e in raw['elements'] if e['type']=='way' and e.get('tags',{}).get('highway') in DRIVABLE and e.get('tags',{}).get('access') not in ('private','no')]
counts=Counter(n for w in ways for n in set(w['nodes']))
SCALE=4

def point(n):
    return [round((n['lon']-121.470)*111320*math.cos(math.radians(31.229))/SCALE,3),round(-(n['lat']-31.229)*111320/SCALE,3)]

def simplify(ids):
    keep=[ids[0]]
    for i in range(1,len(ids)-1):
        a,b,c=point(allnodes[keep[-1]]),point(allnodes[ids[i]]),point(allnodes[ids[i+1]])
        dx,dz=c[0]-a[0],c[1]-a[1]
        deviation=abs(dx*(a[1]-b[1])-(a[0]-b[0])*dz)/max(.01,math.hypot(dx,dz))
        if counts[ids[i]]>1 or deviation>.7 or math.dist(a,b)>22:keep.append(ids[i])
    keep.append(ids[-1]);return keep

nodes=[];edges=[];lookup={}
# OSM node IDs join roads; bridges retain their OSM layer as an elevation hint.
heights={}
ground_nodes=set()
for w in ways:
    t=w['tags']; layer=float(t.get('layer','0')) if t.get('layer','0').lstrip('-').isdigit() else 0
    # layer is relative ordering, not proof that a road is a bridge. In
    # particular Chengdu North Road shares real ground junctions with Beijing
    # West Road; assigning layer*3 to both created artificial crossing ramps.
    bridge=t.get('bridge')=='yes'
    height=max(1,layer)*3 if bridge else 0
    if not bridge:ground_nodes.update(w['nodes'])
    for n in w['nodes']:heights[n]=max(heights.get(n,0),height)
# A bridge meeting a ground road must meet it at ground level, rather than
# lifting the entire ground intersection. Its next bridge segment climbs.
for n in ground_nodes:heights[n]=0
for w in ways:
    t=w['tags'];ids=simplify(w['nodes']);direction=-1 if t.get('oneway')=='-1' else 1 if t.get('oneway')=='yes' or t.get('junction')=='roundabout' else 0
    if direction==-1:ids=ids[::-1]
    for ident in ids:
        if ident not in lookup:
            x,z=point(allnodes[ident]);lookup[ident]=len(nodes)
            nodes.append(dict(id=len(nodes),osm_id=str(ident),x=x,z=z,y=heights[ident],name=t.get('name','未命名道路'),signal=allnodes[ident].get('tags',{}).get('highway')=='traffic_signals'))
    for a,b in zip(ids,ids[1:]):
        na,nb=nodes[lookup[a]],nodes[lookup[b]]
        if a==b:continue
        kind='elevated' if na['y']>0 and nb['y']>0 else 'ramp' if na['y']!=nb['y'] else 'ground'
        edges.append(dict(a=na['id'],b=nb['id'],type=kind,length=round(math.dist([na['x'],na['y'],na['z']],[nb['x'],nb['y'],nb['z']]),3),oneway=direction!=0,name=t.get('name','未命名道路'),highway=t['highway'],osm_id=str(w['id'])))
# Keep the largest strongly connected component: all selectable trips have a legal return path.
adj={n['id']:[] for n in nodes};rev={n['id']:[] for n in nodes}
for e in edges:
    adj[e['a']].append(e['b']);rev[e['b']].append(e['a'])
    if not e['oneway']:adj[e['b']].append(e['a']);rev[e['a']].append(e['b'])
import sys
sys.setrecursionlimit(20000)
seen=set();order=[]
def visit(u):
    seen.add(u)
    for v in adj[u]:
        if v not in seen:visit(v)
    order.append(u)
for u in adj:
    if u not in seen:visit(u)
seen=set();components=[]
def collect(u,out):
    seen.add(u);out.append(u)
    for v in rev[u]:
        if v not in seen:collect(v,out)
for u in reversed(order):
    if u not in seen:
        out=[];collect(u,out);components.append(out)
keep=set(max(components,key=len));mapping={old:i for i,old in enumerate(sorted(keep))}
nodes=[dict(nodes[i],id=mapping[i]) for i in sorted(keep)]
edges=[dict(e,a=mapping[e['a']],b=mapping[e['b']]) for e in edges if e['a'] in keep and e['b'] in keep]
degree=Counter(v for e in edges for v in (e['a'],e['b']))
for n in nodes:n['junction']=degree[n['id']]>=3 and n['y']==0
buildings=[]
for w in raw['elements']:
    t=w.get('tags',{})
    if w['type']!='way' or 'building' not in t:continue
    pts=[point(allnodes[i]) for i in w['nodes'] if i in allnodes]
    if len(pts)<4:continue
    try:h=float(t.get('height',str(float(t.get('building:levels',5))*3)).replace(' m',''))/SCALE
    except ValueError:h=5
    buildings.append(dict(points=pts,height=max(1,min(100,h)),name=t.get('name','')))
data=dict(source='© OpenStreetMap contributors',license='ODbL 1.0',source_url='https://www.openstreetmap.org/#map=15/31.229/121.470',downloaded='2026-09-15',bounds=[31.217,121.451,31.241,121.489],metresPerUnit=SCALE,nodes=nodes,edges=edges,buildings=buildings)
(ROOT/'data/shanghai.json').write_text(json.dumps(data,ensure_ascii=False,separators=(',',':')))
print(f'{len(nodes)} nodes, {len(edges)} edges, {len(buildings)} buildings; {sum(e["type"]!="ground" for e in edges)} elevated/ramp edges')
