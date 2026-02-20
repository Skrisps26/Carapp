import os
from PIL import Image, ImageOps

source_image_path = r"C:\Users\saikr\.gemini\antigravity\brain\44f76f78-6ef9-427a-8126-6af1786e29ef\media__1771487340749.jpg"
assets_dir = r"c:\assva\assets"

def resize_and_pad(src_path, dest_path, size, background_color=(0, 0, 0)):
    try:
        img = Image.open(src_path)
        img.thumbnail(size, Image.Resampling.LANCZOS)
        
        new_img = Image.new("RGB", size, background_color)
        
        # Center the image
        x = (size[0] - img.size[0]) // 2
        y = (size[1] - img.size[1]) // 2
        
        new_img.paste(img, (x, y))
        new_img.save(dest_path, "PNG")
        print(f"Generated {dest_path}")
    except Exception as e:
        print(f"Error processing {dest_path}: {e}")

if __name__ == "__main__":
    if not os.path.exists(assets_dir):
        os.makedirs(assets_dir)

    # icon.png
    resize_and_pad(source_image_path, os.path.join(assets_dir, "icon.png"), (1024, 1024))
    
    # splash.png
    resize_and_pad(source_image_path, os.path.join(assets_dir, "splash.png"), (1242, 2436))
    
    # adaptive-icon.png
    resize_and_pad(source_image_path, os.path.join(assets_dir, "adaptive-icon.png"), (1024, 1024))
