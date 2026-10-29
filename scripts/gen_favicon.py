from PIL import Image
src='assets/images/letter-s-logo.png'
im=Image.open(src).convert('RGBA')
out='assets/images'
sizes={'favicon-16x16.png':16,'favicon-32x32.png':32,'apple-touch-icon.png':180,'android-chrome-192x192.png':192,'android-chrome-512x512.png':512}
for name,sz in sizes.items():
    im.resize((sz,sz),Image.LANCZOS).save(out+'/'+name)
im.resize((256,256),Image.LANCZOS).save(out+'/favicon.ico',format='ICO',sizes=[(16,16),(32,32),(48,48),(64,64),(128,128),(256,256)])
print('done')
