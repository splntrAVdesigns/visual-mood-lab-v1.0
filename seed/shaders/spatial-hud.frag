#version 300 es
precision highp float;
uniform float u_time;
uniform vec2 u_resolution;
uniform float u_rms;
uniform int u_mode; // @label(Instrument) @select(Radial=0 | Alpha=1 | Delta=2 | Sigma=3) @default(1) @group(Instrument)
uniform float u_size; // @label(Element scale) @range(0.45, 2) @default(1) @mod @group(Instrument)
uniform float u_detail; // @label(Instrument detail) @range(2, 8) @default(4) @step(1) @group(Instrument)
uniform float u_ringWeight; // @label(Ring thickness) @range(0.5, 4) @default(1.8) @mod @group(Stroke)
uniform float u_detailWeight; // @label(Detail thickness) @range(0.5, 3) @default(1.2) @mod @group(Stroke)
uniform float u_reticleWeight; // @label(Reticle thickness) @range(0.5, 4) @default(1.8) @mod @group(Stroke)
uniform float u_depth; // @label(Layer depth) @range(0, 1.5) @default(0.75) @mod @group(Motion)
uniform float u_layerMotion; // @label(Layer motion) @range(0, 2) @default(1) @mod @group(Motion)
uniform float u_energy; // @label(Energy) @range(0, 1.5) @default(0.65) @mod @group(Motion)
uniform float u_response; // @label(Audio influence) @range(0, 2) @default(0.7) @mod @group(Motion)
uniform float u_zoom; // @label(View zoom) @range(0.55, 3) @default(1.05) @mod @group(Camera)
uniform float u_pitch; // @label(Camera pitch) @range(-55, 55) @default(15) @unit(deg) @mod @group(Camera)
uniform float u_yaw; // @label(Camera yaw) @range(-55, 55) @default(-15) @unit(deg) @mod @group(Camera)
uniform float u_orbit; // @label(Camera orbit) @range(0, 1) @default(0) @mod @group(Camera)
uniform vec2 u_center; // @label(Center) @range(-1, 1) @default(0, 0) @group(Camera)
uniform float u_lightStrength; // @label(Light strength) @range(0, 1.5) @default(0.85) @mod @group(Lighting)
uniform float u_lightAngle; // @label(Light direction) @range(-180, 180) @default(-35) @unit(deg) @mod @group(Lighting)
uniform vec3 u_structureColor; // @label(Structure) @color @default(0.39, 0.80, 0.89) @group(Color)
uniform vec3 u_dimColor; // @label(Dim elements) @color @default(0.13, 0.25, 0.32) @group(Color)
uniform vec3 u_signalColor; // @label(Signal accents) @color @default(1, 0.69, 0.43) @group(Color)
uniform vec3 u_backgroundColor; // @label(Background) @color @default(0.024, 0.035, 0.051) @group(Color)
out vec4 fragColor;
const float PI=3.14159265;
mat2 rot(float a){return mat2(cos(a),-sin(a),sin(a),cos(a));}
float stroke(float d,float w){float aa=max(fwidth(d),0.0006);return 1.0-smoothstep(w*0.0025,w*0.0025+aa,abs(d));}
float seg(vec2 p,vec2 a,vec2 b){vec2 ab=b-a;return length(p-a-ab*clamp(dot(p-a,ab)/max(dot(ab,ab),0.00001),0.0,1.0));}
float box(vec2 p,vec2 b){vec2 q=abs(p)-b;return length(max(q,0.0))+min(max(q.x,q.y),0.0);}
float ticks(vec2 p,float radius,float count,float phase){float a=atan(p.y,p.x)+phase,w=2.0*PI/count;a=mod(a+w*0.5,w)-w*0.5;vec2 q=vec2(cos(a),sin(a))*length(p);return stroke(seg(q,vec2(radius,0),vec2(radius+0.045,0)),u_detailWeight);}
vec3 turn(vec3 p){p.yz=rot(radians(u_pitch))*p.yz;p.xz=rot(radians(u_yaw)+u_orbit*0.13*sin(u_time*0.2))*p.xz;return p;}
vec2 plane(vec3 ro,vec3 rd,float z){return (ro+rd*((z-ro.z)/rd.z)).xy/u_size;}
void main(){vec2 uv=((2.0*gl_FragCoord.xy-u_resolution)/u_resolution.y-u_center)/u_zoom;vec3 ro=turn(vec3(0,0,5.6)),rd=turn(normalize(vec3(uv*1.48,-5.6)));vec3 col=u_backgroundColor;float t=u_time*u_layerMotion,d=u_depth*(1.0+u_energy*u_rms*u_response*0.22);
 // Each instrument layer is sampled by intersecting the camera ray with
 // a rigid world plane. Pitch/yaw never warp a layer's internal geometry.
 for(int layer=0;layer<5;layer++){float l=float(layer),z=(2.0-l)*d*0.22;vec2 p=plane(ro,rd,z);float r=length(p),a=atan(p.y,p.x),phase=t*(mod(l,2.0)<0.5?0.13:-0.19),primary=0.0,accent=0.0,dim=0.0;
  if(u_mode==0){float radius=0.46+l*0.18;dim=stroke(r-radius,u_ringWeight)*0.6;primary=ticks(p,radius,u_detail*6.0,phase);float sweep=step(mod(a-phase+PI*2.0,PI*2.0),PI*0.6);accent=stroke(r-radius+0.035,u_ringWeight)*sweep;
   if(layer==2||layer==4){float n=u_detail*4.0+2.0,w=2.0*PI/n,aa=mod(a-phase+w*0.5,w)-w*0.5;vec2 q=vec2(cos(aa),sin(aa))*r-vec2(radius,0);primary=max(primary,1.0-smoothstep(0.0,max(fwidth(r),0.001),box(q,vec2(0.025,0.045))));}}
  if(u_mode==1){if(layer<3){float radius=0.69+l*0.15;float arc=step(mod(a+phase+PI*2.0,PI*2.0/3.0),1.35);primary=stroke(r-radius,u_ringWeight)*arc;dim=ticks(p,radius,36.0,phase)*0.7;if(layer==1){accent=primary;primary=0.0;}}
   if(layer==3){vec2 q=vec2(abs(p.x),p.y);primary=stroke(seg(q,vec2(0.72,0.52),vec2(1.08,0.72)),u_detailWeight);primary=max(primary,stroke(seg(q,vec2(1.08,0.72),vec2(1.55,0.72)),u_detailWeight));primary=max(primary,stroke(seg(q,vec2(0.76,-0.55),vec2(1.08,-0.78)),u_detailWeight));primary=max(primary,stroke(seg(q,vec2(1.08,-0.78),vec2(1.55,-0.78)),u_detailWeight));
    float row=floor((q.y+0.5)/0.07),yy=mod(q.y+0.5,0.07)-0.035,len=0.045+0.16*(0.5+0.5*sin(t*2.0+row*0.6))*(1.0+u_energy*u_rms*u_response);if(row>=0.0&&row<14.0)primary=max(primary,stroke(seg(vec2(q.x,yy),vec2(1.08,0),vec2(1.08+len,0)),u_detailWeight*1.5));vec2 mini=q-vec2(1.42,-0.38);primary=max(primary,stroke(length(mini)-0.19,u_ringWeight));accent=stroke(length(mini)-0.15,u_ringWeight)*step(mod(atan(mini.y,mini.x)+t+6.283,6.283),4.0);}}
  if(u_mode==2){float bob=0.07*sin(t*0.7+l*0.6)*u_energy;p.y+=bob;float x=abs(p.x);
   if(layer==0){float h=0.055;vec2 grid=vec2(p.x, (p.y+0.62)*2.0);float gy=mod(grid.y+t*0.08,0.12)-0.06;dim=stroke(gy,u_detailWeight)*step(p.y,-0.35)*step(-1.25,p.y)*step(x,1.8)*0.6;dim=max(dim,stroke(mod(grid.x+0.1,0.2)-0.1,u_detailWeight)*step(p.y,-0.35)*step(-1.25,p.y)*step(x,1.8)*0.4);}
   if(layer==1){primary=stroke(seg(p,vec2(-1.5,0),vec2(1.5,0)),u_detailWeight);accent=stroke(r-0.92,u_ringWeight)*step(a,2.75)*step(0.4,a);}
   if(layer==2){for(int k=-3;k<=3;k++){if(k==0)continue;float y=float(k)*0.14+0.025*u_layerMotion*sin(t+float(k)*0.8);float w=0.32+0.06*abs(float(k));primary=max(primary,stroke(seg(vec2(x,p.y),vec2(0.06,y),vec2(w,y)),u_detailWeight));}}
   if(layer==3){primary=stroke(seg(vec2(x,p.y),vec2(1.08,-0.65),vec2(1.08,0.65)),u_detailWeight);float y=mod(p.y+0.045,0.09)-0.045;if(abs(p.y)<0.65)primary=max(primary,stroke(seg(vec2(x,y),vec2(0.99,0),vec2(1.08,0)),u_detailWeight));}}
  if(u_mode==3&&layer<3){float radius=0.72+l*0.17;float arc=step(mod(a+phase+PI*2.0,PI*2.0/3.0),1.45);primary=stroke(r-radius,u_ringWeight*(layer==2?1.7:1.0))*arc;dim=ticks(p,radius,42.0,-phase)*0.8;if(layer==1){accent=primary;primary=0.0;}}
  if(u_mode==3&&layer==3){float n=u_detail*3.0,w=2.0*PI/n,aa=mod(a-t*0.09+w*0.5,w)-w*0.5;vec2 q=vec2(cos(aa),sin(aa))*r-vec2(1.12,0);primary=1.0-smoothstep(0.0,max(fwidth(r),0.001),box(q,vec2(0.022,0.05)));}
  float light=0.6+u_lightStrength*(0.4+0.18*cos(a-radians(u_lightAngle)));col+=u_dimColor*dim+u_structureColor*primary*light+u_signalColor*accent*light;
 }
 vec2 p=plane(ro,rd,-0.65*d);float reticle=0.0;
 if(u_mode==3){for(int i=0;i<3;i++){float a=float(i)*PI*2.0/3.0+PI*0.5,b=a+PI*2.0/3.0;reticle=max(reticle,stroke(seg(p,vec2(cos(a),sin(a))*0.32,vec2(cos(b),sin(b))*0.32),u_reticleWeight));}}
 else if(u_mode==2){reticle=stroke(seg(vec2(abs(p.x),p.y),vec2(0.13,0),vec2(0.32,0)),u_reticleWeight);reticle=max(reticle,stroke(seg(vec2(abs(p.x),p.y),vec2(0.07,-0.07),vec2(0.13,0)),u_reticleWeight));reticle=max(reticle,stroke(length(p)-0.05,u_reticleWeight));}
 else{reticle=max(stroke(seg(p,vec2(-0.12,0),vec2(0.12,0)),u_reticleWeight),stroke(seg(p,vec2(0,-0.12),vec2(0,0.12)),u_reticleWeight));if(u_mode==0)reticle=max(reticle,stroke(length(p)-0.2,u_reticleWeight));}
 col+=u_signalColor*reticle;
 if(u_mode==1){vec3 rro=ro/u_size;float b=dot(rro,rd),c=dot(rro,rro)-0.55*0.55,disc=b*b-c;if(disc>0.0){vec3 hit=rro+rd*(-b-sqrt(disc));hit.xz=rot(t*0.2)*hit.xz;float theta=atan(hit.z,hit.x),phi=asin(clamp(hit.y/0.55,-1.0,1.0));float lon=abs(fract(theta/PI*8.0)-0.5),lat=abs(fract(phi/PI*10.0)-0.5);float grid=max(1.0-smoothstep(0.0,max(fwidth(lon),0.002)*u_detailWeight,lon),1.0-smoothstep(0.0,max(fwidth(lat),0.002)*u_detailWeight,lat));col+=u_structureColor*grid*0.55;float scan=hit.y*cos(t*0.6)+hit.z*sin(t*0.6);col+=u_signalColor*stroke(scan,u_ringWeight);}}
 fragColor=vec4(col,1);
}
