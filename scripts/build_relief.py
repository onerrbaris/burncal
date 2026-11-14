from urllib.request import urlopen
from PIL import Image
import numpy as np
import io, time
from pathlib import Path
out=Path("frontend")
lon=np.linspace(24,46,880)
lat=np.radians(np.linspace(44,34,400))
x=((lon+180)/360*32*256).astype(int)
y=((1-np.arcsinh(np.tan(lat))/np.pi)/2*32*256).astype(int)
dem=np.zeros((len(y),len(x)))
for i in np.unique(x//256):
 for j in np.unique(y//256):
  for attempt in range(6):
   try:
    tile=np.array(Image.open(io.BytesIO(urlopen(f"https://s3.amazonaws.com/elevation-tiles-prod/terrarium/5/{i}/{j}.png",timeout=12).read())).convert("RGB"),dtype=float)
    break
   except OSError:
    if attempt==5: raise
    time.sleep(1)
  ix=x//256==i; iy=y//256==j
  rgb=tile[np.ix_(y[iy]%256,x[ix]%256)]
  dem[np.ix_(iy,ix)]=rgb[:,:,0]*256+rgb[:,:,1]+rgb[:,:,2]/256-32768
Image.fromarray(np.uint8(np.clip(dem/20,0,255))).save(out/"relief.png")
