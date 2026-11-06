import sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from PIL import Image,ImageDraw
from clip_photo import shoe_letterbox

class ClipPhotoTests(unittest.TestCase):
    def test_long_shoe_keeps_both_toe_and_heel_in_square_input(self):
        photo=Image.new('RGB',(1000,400),'white');d=ImageDraw.Draw(photo);d.rectangle((50,150,949,249),fill='black');d.rectangle((50,150,120,249),fill='red');d.rectangle((880,150,949,249),fill='blue')
        prepared=shoe_letterbox(photo);self.assertEqual(prepared.width,prepared.height)
        colors=prepared.getcolors(prepared.width*prepared.height);self.assertTrue(any(c==(255,0,0) for _,c in colors));self.assertTrue(any(c==(0,0,255) for _,c in colors));self.assertEqual(photo.size,(1000,400))
    def test_empty_photos_never_turn_into_fabricated_training_examples(self):
        with self.assertRaises(ValueError):shoe_letterbox(Image.new('RGB',(200,200),'white'))
    def test_transparent_background_is_composited_without_changing_original(self):
        photo=Image.new('RGBA',(400,200),(0,0,0,0));ImageDraw.Draw(photo).rectangle((20,80,379,119),fill=(10,20,30,255));out=shoe_letterbox(photo);self.assertEqual(out.mode,'RGB');self.assertEqual(photo.mode,'RGBA')

if __name__=='__main__':unittest.main()
