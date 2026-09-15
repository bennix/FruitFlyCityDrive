// Place independent brain windows on a reception-time axis. Gaps are unknown,
// not silence in a continuously simulated brain; never duplicate old spikes.
export class SpikeTimeline {
  constructor(span=20){this.span=span;this.windows=[];this.rows=new Map();}
  append(data,receivedAt){
    for(const neuron of data.raster)if(!this.rows.has(neuron.id)&&this.rows.size<160)this.rows.set(neuron.id,this.rows.size);
    this.windows.push({data,end:receivedAt});
    this.trim(receivedAt);
  }
  trim(now){this.windows=this.windows.filter(w=>w.end>=now-this.span);}
  points(now){
    this.trim(now);
    const points=[];
    for(const {data,end} of this.windows)for(const n of data.raster){
      const row=this.rows.get(n.id);if(row===undefined)continue;
      for(const t of n.times){const time=end-data.duration_sec+t,x=(time-now+this.span)/this.span;
        if(x>=0&&x<=1)points.push({x,row,id:n.id,time});}
    }
    return points;
  }
}

// Brightness follows recorded spikes only; future events never light a node.
export function spikeGlow(times,time) {
  let latest=-Infinity;
  for(const spike of times)if(spike<=time)latest=Math.max(latest,spike);
  return Math.exp(-(time-latest)/.12);
}
