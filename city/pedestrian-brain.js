// Lightweight fly-inspired LIF circuit; not a reconstructed fly connectome.
// Each pedestrian owns membrane potentials, spike history and motor traces.
export class PedestrianBrain {
  constructor(seed=1) {
    this.seed=seed;this.time=0;this.voltage=new Float64Array(24);
    this.trace=new Float64Array(24);this.spikes=Array.from({length:24},()=>[]);
    this.drive=0;this.turn=0;
  }
  random(){this.seed=(Math.imul(this.seed,1664525)+1013904223)>>>0;return this.seed/4294967296;}
  step(dt,{turn=0,hazard=false,waiting=false}={}) {
    let remaining=dt;
    while(remaining>1e-8) {
      const h=Math.min(.01,remaining);remaining-=h;this.time+=h;
      for(let i=0;i<24;i++) {
        const side=i%2?1:-1;
        const sensory=i<8?1.5+side*turn*.5:i<16?1.2+(hazard?.5:0):1.5+side*turn*.35;
        const inhibition=i>=16?(waiting?.9:hazard?.25:0):0;
        const recurrent=i>=8?this.trace[i-8]*.08:0;
        const input=sensory-inhibition+recurrent+(this.random()-.5)*.3;
        this.voltage[i]+=(input-this.voltage[i])*h/.025;
        this.trace[i]*=Math.exp(-h/.08);
        if(this.voltage[i]>=1){this.voltage[i]=0;this.trace[i]+=1;this.spikes[i].push(this.time);}
        while(this.spikes[i].length&&this.spikes[i][0]<this.time-.4)this.spikes[i].shift();
      }
    }
    const left=this.trace[16]+this.trace[18]+this.trace[20]+this.trace[22];
    const right=this.trace[17]+this.trace[19]+this.trace[21]+this.trace[23];
    this.drive=Math.min(1,(left+right)/12);
    this.turn=Math.max(-1,Math.min(1,(right-left)/8));
    return this;
  }
  snapshot() {
    const raster=this.spikes.map((times,i)=>({id:String(i+1),times:times.map(t=>t-Math.max(0,this.time-.4))}));
    return {raster,total_spikes:raster.reduce((n,r)=>n+r.times.length,0),active_neurons:raster.filter(r=>r.times.length).length,output_neuron_activity:{},duration_sec:.4};
  }
}
