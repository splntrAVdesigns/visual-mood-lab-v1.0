#version 300 es
precision highp float;
uniform float u_time;
uniform vec2 u_resolution;
uniform float u_rms;
uniform int u_pattern; // @label(Pattern) @select(Translation=0 | Reflection=1 | Glide reflection=2 | Rotation=3 | Random=4) @default(0) @group(Geometry)
uniform int u_shape; // @label(Shape) @select(Square=0 | Triangle=1 | Hexagon=2 | Circle=3 | Diamond=4 | Star=5) @default(0) @group(Geometry)
uniform int u_count; // @label(Unit count) @range(3, 10) @default(6) @group(Geometry)
uniform float u_size; // @label(Element scale) @range(0.45, 1.3) @default(1) @mod @group(Geometry)
uniform float u_depth; // @label(Depth) @range(0, 1.5) @default(0.7) @mod @group(Geometry)
uniform float u_weight; // @label(Frame thickness) @range(0.04, 0.35) @default(0.17) @mod @group(Geometry)
uniform float u_motion; // @label(Motion amount) @range(0, 2) @default(1) @mod @group(Motion)
uniform float u_energy; // @label(Energy) @range(0, 1.5) @default(0.65) @mod @group(Motion)
uniform float u_response; // @label(Audio influence) @range(0, 2) @default(0.7) @mod @group(Motion)
uniform float u_randomSeed; // @label(Random seed) @range(0, 100) @default(7) @step(1) @noroll @nomidi @group(Motion) @showIf(u_pattern=4)
uniform float u_zoom; // @label(View zoom) @range(0.55, 3) @default(1) @mod @group(Camera)
uniform float u_pitch; // @label(Camera pitch) @range(-55, 55) @default(22) @unit(deg) @mod @group(Camera)
uniform float u_yaw; // @label(Camera yaw) @range(-55, 55) @default(-18) @unit(deg) @mod @group(Camera)
uniform vec2 u_center; // @label(Center) @range(-1, 1) @default(0, 0) @group(Camera)
uniform float u_lightAngle; // @label(Light direction) @range(-180, 180) @default(-35) @unit(deg) @mod @group(Lighting)
uniform float u_lightStrength; // @label(Light strength) @range(0, 1.5) @default(0.85) @mod @group(Lighting)
uniform vec3 u_frontColor; // @label(Front faces) @color @default(0.53, 0.85, 0.91) @group(Color)
uniform vec3 u_sideColor; // @label(Side faces) @color @default(0.15, 0.25, 0.30) @group(Color)
uniform vec3 u_edgeColor; // @label(Inner edges) @color @default(1, 0.74, 0.52) @group(Color)
uniform vec3 u_backgroundColor; // @label(Background) @color @default(0.024, 0.035, 0.051) @group(Color)
out vec4 fragColor;
const float PI=3.14159265;
mat2 rot(float a){return mat2(cos(a),-sin(a),sin(a),cos(a));}
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float outline(vec2 p,float r){if(u_shape==3)return length(p)-r;if(u_shape==4){p.y*=0.77;return (abs(p.x)+abs(p.y)-r)*0.7;}float n=u_shape==1?3.0:u_shape==2?6.0:4.0;float a=atan(p.y,p.x)+PI*0.5;if(u_shape==5)return (length(p)-r*(0.76+0.24*cos(a*6.0)))*0.45;return cos(floor(0.5+a/(2.0*PI/n))*(2.0*PI/n)-a)*length(p)-r*0.78;}
float scene(vec3 p){float count=float(u_count),stepSize=2.4/count;vec2 pp=p.xy,id,local;
 if(u_pattern==3){float a=atan(pp.y,pp.x),w=2.0*PI/count;float sector=floor((a+w*0.5)/w);pp=rot(sector*w)*pp;id=vec2(floor(length(pp)/stepSize),0);local=vec2(pp.x-(id.x+0.5)*stepSize,pp.y);}
 else{if(u_pattern==1)pp.x=abs(pp.x);float row=floor((pp.y+1.2)/stepSize);if(u_pattern==2)pp.x+=mod(row,2.0)*stepSize*0.5;id=floor((pp+1.2)/stepSize);local=mod(pp+1.2,stepSize)-stepSize*0.5;if(u_pattern==2)local.x*=mod(row,2.0)*2.0-1.0;}
 float t=u_time,phase=id.x*0.38+id.y*0.28,angle=0.24*sin(t+phase),lift=sin(t+phase)*0.13;
 if(u_pattern==4){float epoch=floor(t*0.32),u=smoothstep(0.0,1.0,fract(t*0.32));vec2 key=id+u_randomSeed;vec2 a=vec2(hash(key+epoch*13.0),hash(key+epoch*17.0+8.0)),b=vec2(hash(key+(epoch+1.0)*13.0),hash(key+(epoch+1.0)*17.0+8.0));vec2 random=mix(a,b,u);local-=(random-0.5)*stepSize*0.3*u_motion;angle=(random.x-0.5)*6.283;lift=(random.y-0.5)*0.6;}
 float energy=1.0+u_energy*u_rms*u_response;local=rot(angle*u_motion)*local;float r=stepSize*0.37*u_size;float edge=abs(outline(local,r))-r*u_weight;
 float d=max(edge,abs(p.z-lift*u_depth*u_motion*energy)-max(0.008,u_depth*0.09));
 float bound=u_pattern==3?length(p.xy)-1.45:max(abs(p.x),abs(p.y))-1.2;return max(d,bound);}
vec3 turn(vec3 p){p.yz=rot(radians(u_pitch))*p.yz;p.xz=rot(radians(u_yaw))*p.xz;return p;}
void main(){vec2 uv=((2.0*gl_FragCoord.xy-u_resolution)/u_resolution.y-u_center)/u_zoom;vec3 ro=turn(vec3(0,0,5.6)),rd=turn(normalize(vec3(uv,-3.2)));float t=0.0;bool hit=false;vec3 p;
 for(int i=0;i<88;i++){p=ro+rd*t;float d=scene(p);if(d<0.0018){hit=true;break;}t+=max(d*0.65,0.001);if(t>8.0)break;}
 vec3 col=u_backgroundColor;if(hit){float e=0.0015;vec3 n=normalize(vec3(scene(p+vec3(e,0,0))-scene(p-vec3(e,0,0)),scene(p+vec3(0,e,0))-scene(p-vec3(0,e,0)),scene(p+vec3(0,0,e))-scene(p-vec3(0,0,e))));vec3 light=normalize(vec3(cos(radians(u_lightAngle)),sin(radians(u_lightAngle)),1));float lit=0.25+u_lightStrength*max(dot(n,light),0.0);col=mix(u_sideColor,u_frontColor,smoothstep(0.3,0.9,abs(n.z)))*lit;col+=u_edgeColor*pow(1.0-max(dot(n,-rd),0.0),3.0)*0.35;}
 fragColor=vec4(col,1);}
