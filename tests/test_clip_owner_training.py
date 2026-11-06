import sys, unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from train_visual_owner import split_request

def request():
    return {'batchId':'priority-20261106-v1','members':[{'imageHash':f'{i+1:064x}','modelKey':f'model-{i}','brand':f'brand-{i//32}','role':('train','calibration','test')[i//32],'category':'low-profile' if i%2 else 'court-other','status':'approved','revision':1} for i in range(96)]}

class OwnerTrainingContracts(unittest.TestCase):
    def test_owner_holdout_never_enters_training_and_exclusions_have_no_truth(self):
        data=request();data['members'][35].update(status='excluded',category=None)
        groups,aux=split_request(data,[{'imageHash':'f'*64,'modelKey':'old-design','brand':'brand-0','split':'train','truth':'chunky'},{'imageHash':'e'*64,'modelKey':'eval-old','brand':'brand-1','split':'test','truth':'boot'}])
        self.assertEqual({r['labelSource'] for r in groups['test']},{'authenticated-owner'})
        self.assertEqual([len(groups[r]) for r in ('train','calibration','test')],[32,31,32]);self.assertEqual(len(aux),1)
        self.assertTrue({r['imageHash'] for r in groups['train']}.isdisjoint(r['imageHash'] for r in groups['test']))
    def test_cross_brand_and_design_leakage_is_rejected(self):
        for field,value in [('brand','brand-0'),('modelKey','model-1'),('imageHash',f'{2:064x}')]:
            data=request();data['members'][40][field]=value
            with self.assertRaises(ValueError):split_request(data)
        with self.assertRaises(ValueError):split_request(request(),[{'imageHash':'f'*64,'modelKey':'old','brand':'brand-2','split':'train','truth':'chunky'}])
    def test_incomplete_or_synthetic_status_is_not_owner_ground_truth(self):
        for change in [{'status':'review-needed'},{'status':'auto'},{'revision':0},{'category':'fashion'},{'status':'excluded','category':'chunky'}]:
            data=request();data['members'][0].update(change)
            with self.assertRaises(ValueError):split_request(data)

if __name__=='__main__':unittest.main()
