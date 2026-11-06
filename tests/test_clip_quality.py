import sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from clip_quality import split_brand,calibrate,release_gates,metrics

class ClipQualityTests(unittest.TestCase):
    def test_existing_training_brand_cannot_leak_into_validation(self):
        for name in ['Nike','NIKE','Fila China','adidas Originals','Rockfish Weatherwear']:
            self.assertEqual(split_brand(name,['Nike','FILA','adidas','Rockfish']),'train')
        self.assertEqual(split_brand('New Balance',[]),split_brand('new balance',[]))
    def test_calibration_cannot_read_test_labels(self):
        with self.assertRaises(ValueError):calibrate([{'split':'test','category':'chunky'}])
    def test_bad_precision_and_small_samples_do_not_release(self):
        rows=[dict(split='calibration',category='chunky',truth='chunky' if i<7 else 'court-other',confidence=.99,margin=.8) for i in range(10)]
        self.assertEqual(calibrate(rows),{})
        self.assertEqual(calibrate([{**rows[0],'truth':'chunky'}]*7),{})
    def test_thresholds_frozen_on_calibration_need_independent_test_success(self):
        rows=[dict(split='calibration',category='chunky',truth='chunky',confidence=.9,margin=.4) for _ in range(10)]
        gates=calibrate(rows);self.assertIn('chunky',gates)
        good=[{**r,'split':'test'} for r in rows];self.assertIn('chunky',release_gates(gates,good))
        bad=[{**r,'truth':'low-profile'} for r in good];self.assertEqual(release_gates(gates,bad),{})
        self.assertEqual(release_gates(gates,good[:7]),{})
        with self.assertRaises(ValueError):release_gates(gates,rows)
    def test_metrics_keep_unknown_unscored_and_count_all_labeled_errors(self):
        self.assertEqual(metrics([])['accuracy'],None)
        result=metrics([{'truth':'chunky','category':'chunky'},{'truth':'chunky','category':'court-other'},{'truth':None,'category':'chunky'}])
        self.assertEqual(result['n'],2);self.assertEqual(result['accuracy'],.5)

if __name__=='__main__':unittest.main()
