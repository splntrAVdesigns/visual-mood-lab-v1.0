#version 300 es
precision highp float;
// Analytic standing-wave modes with granular shading. This is a cymatic
// visualization, not a calibrated plate or a persistent particle simulation.
uniform float u_time;
uniform vec2 u_resolution;
uniform vec3 u_trackTone; // host: playing flag, smoothed dominant Hz, signal energy
uniform float u_rms;
uniform int u_pattern; // @label(Pattern) @select(Rounded nodes=0 | Cross modes=1 | Hybrid modes=2) @default(1) @group(Pattern)
uniform int u_drive; // @label(Excitation) @select(Auto and track=0 | Manual tone=1) @default(0) @group(Pattern) @noroll
uniform float u_tone; // @label(Tone) @range(55, 6000) @default(180) @log @unit(Hz) @mod @group(Pattern) @hint(Manual excitation or the starting toneIndex for autonomous motion.)
uniform float u_evolution; // @label(Evolution rate) @range(0, 2) @default(0.7) @mod @group(Pattern) @showIf(u_drive=0)
uniform float u_pitchMod; // @label(Pitch modulation) @range(0, 1) @default(0.12) @mod @group(Pattern)
uniform float u_complexity; // @label(Mode complexity) @range(0, 5) @default(0) @mod @group(Pattern)
uniform float u_response; // @label(Audio influence) @range(0, 1) @default(1) @mod @group(Pattern)
uniform float u_width; // @label(Strand width) @range(0.3, 3) @default(1.3) @mod @group(Grains)
uniform float u_definition; // @label(Pattern definition) @range(0.2, 1.5) @default(0.85) @mod @group(Grains)
uniform float u_grainSize; // @label(Grain size) @range(0.45, 2) @default(1) @mod @group(Grains)
uniform float u_density; // @label(Grain density) @range(0.2, 1) @default(0.85) @mod @group(Grains)
uniform float u_energy; // @label(Energy) @range(0, 1.5) @default(0.65) @mod @group(Grains)
uniform float u_relief; // @label(Grain relief) @range(0, 1.5) @default(0.6) @mod @group(Lighting)
uniform float u_lightAngle; // @label(Light direction) @range(-180, 180) @default(-35) @unit(deg) @mod @group(Lighting)
uniform float u_lightStrength; // @label(Light strength) @range(0, 1.5) @default(0.85) @mod @group(Lighting)
uniform vec2 u_center; // @label(Center) @range(-1, 1) @default(0, 0) @group(Composition)
uniform float u_zoom; // @label(View zoom) @range(0.55, 3) @default(1) @mod @group(Composition)
uniform vec3 u_grainColor; // @label(Grains) @color @default(0.9, 0.83, 0.59) @group(Color)
uniform vec3 u_shadowColor; // @label(Shadows) @color @default(0.20, 0.23, 0.18) @group(Color)
uniform vec3 u_glintColor; // @label(Glints) @color @default(1, 0.95, 0.77) @group(Color)
uniform vec3 u_backgroundColor; // @label(Background) @color @default(0.027, 0.035, 0.039) @group(Color)
out vec4 fragColor;
const float PI=3.14159265;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
vec2 modePair(float i){i=mod(i,12.0);if(i<1.0)return vec2(1,2);if(i<2.0)return vec2(2,3);if(i<3.0)return vec2(1,4);if(i<4.0)return vec2(3,4);if(i<5.0)return vec2(2,5);if(i<6.0)return vec2(4,5);if(i<7.0)return vec2(3,6);if(i<8.0)return vec2(5,6);if(i<9.0)return vec2(4,7);if(i<10.0)return vec2(6,7);if(i<11.0)return vec2(5,8);return vec2(7,8);}
float modal(vec2 p,vec2 mn){mn+=u_complexity;float crossMode=cos(mn.x*PI*p.x)*cos(mn.y*PI*p.y)-cos(mn.y*PI*p.x)*cos(mn.x*PI*p.y);float r=length(p),a=atan(p.y,p.x);float radial=cos(r*mn.y*PI)+0.4*cos((4.0+2.0*floor(u_complexity))*a)*sin(r*mn.x*PI);radial=mix(radial,crossMode,clamp((mn.y-3.0)*0.16,0.0,0.85));return u_pattern==0?radial:u_pattern==1?crossMode:mix(radial,crossMode,0.65);}
float field(vec2 p,float pos){float i=floor(pos),f=smoothstep(0.0,1.0,fract(pos));return mix(modal(p,modePair(i)),modal(p,modePair(i+1.0)),f);}
void main(){
 float driven=u_drive==0?u_trackTone.x*u_response:0.0;
 float tone=mix(u_tone,max(55.0,u_trackTone.y),driven)*exp2(u_pitchMod*sin(u_time*1.2));
 float toneIndex=clamp(log2(max(55.0,tone)/55.0)/log2(6000.0/55.0),0.0,1.0)*10.0;
 float pos=toneIndex+(u_drive==0?(1.0-driven)*u_time*u_evolution*0.55:0.0);
 vec2 p=((2.0*gl_FragCoord.xy-u_resolution)/u_resolution.y-u_center)/u_zoom;
 float e=0.001, f=field(p,pos);vec2 grad=vec2(field(p+vec2(e,0),pos)-field(p-vec2(e,0),pos),field(p+vec2(0,e),pos)-field(p-vec2(0,e),pos))/(2.0*e);
 float dist=abs(f)/max(length(grad),0.3),width=u_width*0.009*(1.0+0.35*driven*u_trackTone.z);
 float band=1.0-smoothstep(width*0.45,width*(1.9-0.65*u_definition),dist);
 // Grain coordinates stay in material space when zooming. Small flow follows
 // the changing field; no random per-frame reseeding or screen-space flicker.
 vec2 gp=p*220.0/u_grainSize+0.12*u_energy*vec2(sin(u_time*0.8),cos(u_time*0.7));
 vec2 id=floor(gp),local=fract(gp)-0.5;float h=hash(id),radius=mix(0.14,0.48,hash(id+13.0));
 vec2 off=vec2(hash(id+4.0),hash(id+9.0))*0.3-0.15;vec2 grain=local-off;
 float aa=max(fwidth(length(grain)),0.015),dotMask=1.0-smoothstep(radius-aa,radius+aa,length(grain));dotMask*=step(h, u_density);
 vec3 normal=normalize(vec3(grain*u_relief*3.0,1.0));vec3 light=normalize(vec3(cos(radians(u_lightAngle)),sin(radians(u_lightAngle)),0.7));
 float lit=0.4+u_lightStrength*max(0.0,dot(normal,light));float spec=pow(max(0.0,dot(normal,normalize(light+vec3(0,0,1)))),20.0)*u_relief;
 vec3 grains=mix(u_shadowColor,u_grainColor,clamp(lit,0.0,1.0))+u_glintColor*spec*u_lightStrength;
 vec3 col=mix(u_backgroundColor,u_shadowColor,band*0.35);
 col=mix(col,grains,band*(0.18+0.82*dotMask));fragColor=vec4(col,1);
}
