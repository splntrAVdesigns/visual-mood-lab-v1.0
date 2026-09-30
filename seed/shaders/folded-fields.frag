#version 300 es
precision highp float;
uniform float u_time;
uniform vec2 u_resolution;
uniform float u_rms;
uniform int u_pattern; // @label(Pattern) @select(Contour weave=0 | Ribbon terrain=1 | Folded cells=2) @default(0) @group(Surface)
uniform float u_span; // @label(Fold span) @range(0.45, 2) @default(1) @mod @group(Surface)
uniform float u_depth; // @label(Depth) @range(0, 1.5) @default(0.7) @mod @group(Surface)
uniform float u_density; // @label(Contour density) @range(8, 45) @default(22) @mod @group(Surface) @showIf(u_pattern!=2)
uniform float u_seam; // @label(Seam thickness) @range(0.3, 3) @default(1) @mod @group(Surface) @showIf(u_pattern=2)
uniform float u_motion; // @label(Fold motion) @range(0, 2) @default(1) @mod @group(Motion)
uniform float u_energy; // @label(Energy) @range(0, 1.5) @default(0.65) @mod @group(Motion)
uniform float u_response; // @label(Audio influence) @range(0, 2) @default(0.7) @mod @group(Motion)
uniform float u_zoom; // @label(View zoom) @range(0.55, 3) @default(1) @mod @group(Camera)
uniform float u_pitch; // @label(Camera pitch) @range(-55, 55) @default(30) @unit(deg) @mod @group(Camera)
uniform float u_yaw; // @label(Camera yaw) @range(-55, 55) @default(-18) @unit(deg) @mod @group(Camera)
uniform vec2 u_center; // @label(Center) @range(-1, 1) @default(0, 0) @group(Camera)
uniform float u_lightAngle; // @label(Light direction) @range(-180, 180) @default(-35) @unit(deg) @mod @group(Lighting)
uniform float u_lightStrength; // @label(Light strength) @range(0, 1.5) @default(0.85) @mod @group(Lighting)
uniform vec3 u_contourColor; // @label(Contours) @color @default(0.77, 0.89, 0.94) @group(Color)
uniform vec3 u_valleyColor; // @label(Valleys) @color @default(0.14, 0.24, 0.33) @group(Color)
uniform vec3 u_crestColor; // @label(Crests) @color @default(0.91, 0.65, 0.46) @group(Color)
uniform vec3 u_backgroundColor; // @label(Background) @color @default(0.02, 0.03, 0.05) @group(Color)
out vec4 fragColor;
mat2 rot(float a){return mat2(cos(a),-sin(a),sin(a),cos(a));}
float surface(vec2 p){p/=u_span;float t=u_time*u_motion,amp=u_depth*(0.18+0.09*u_energy+0.12*u_rms*u_response);
 if(u_pattern==2){vec2 id=floor(p*2.5),cell=fract(p*2.5)-0.5;float peak=1.0-2.0*max(abs(cell.x),abs(cell.y));return amp*peak*(0.5+0.5*sin(t*1.5+id.x*0.65+id.y*0.48));}
 if(u_pattern==1)return amp*(sin(p.x*2.2+t*0.65)+0.42*cos(p.y*2.7-t*0.65)+0.24*sin(p.x+p.y*2.0-t*0.65));
 return amp*cos(p.x*2.7+t*0.65)*cos(p.y*2.7-t*0.455);
}
vec3 turn(vec3 p){p.yz=rot(radians(u_pitch))*p.yz;p.xy=rot(radians(u_yaw))*p.xy;return p;}
void main(){vec2 uv=((2.0*gl_FragCoord.xy-u_resolution)/u_resolution.y-u_center)/u_zoom;
 // Orthographic camera covers an unbounded height field at every angle.
 vec3 ro=turn(vec3(uv*1.8,3.0)),rd=turn(vec3(0,0,-1));float bound=0.85;
 float lo=(bound-ro.z)/rd.z,hi=(-bound-ro.z)/rd.z,prev=lo,t=lo;bool hit=false;
 for(int i=1;i<=56;i++){t=mix(lo,hi,float(i)/56.0);vec3 p=ro+rd*t;if(p.z<=surface(p.xy)){hit=true;break;}prev=t;}
 if(!hit){fragColor=vec4(u_backgroundColor,1);return;}
 for(int i=0;i<6;i++){float mid=(prev+t)*0.5;vec3 p=ro+rd*mid;if(p.z>surface(p.xy))prev=mid;else t=mid;}
 vec3 p=ro+rd*t;float e=0.002;vec2 grad=vec2(surface(p.xy+vec2(e,0))-surface(p.xy-vec2(e,0)),surface(p.xy+vec2(0,e))-surface(p.xy-vec2(0,e)))/(2.0*e);
 vec3 n=normalize(vec3(-grad,1)),light=normalize(vec3(cos(radians(u_lightAngle)),sin(radians(u_lightAngle)),0.9));float lit=0.25+u_lightStrength*max(dot(n,light),0.0);
 vec3 col=mix(u_valleyColor,u_crestColor,clamp(0.4+p.z*1.5,0.0,1.0))*lit;
 float lines;
 if(u_pattern==2){vec2 c=fract(p.xy/u_span*2.5)-0.5;float d=min(abs(abs(c.x)-abs(c.y)),0.5-max(abs(c.x),abs(c.y)));float aa=max(fwidth(d),0.0005);lines=1.0-smoothstep(aa*0.15*u_seam,aa*(0.15*u_seam+0.7),d);}
 else{float v=p.y/u_span*u_density;float d=abs(fract(v)-0.5),aa=clamp(fwidth(v),0.005,0.25);lines=1.0-smoothstep(0.025,0.025+aa*0.7,d);}
 col=mix(col*0.5,u_contourColor*(0.55+lit*0.45),lines*0.72);fragColor=vec4(col,1);}
