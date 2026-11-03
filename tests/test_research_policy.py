import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'scripts'))
from research_policy import allowed_feed_record

class ResearchPolicyTest(unittest.TestCase):
    def test_excluded_tag_in_a_combination(self):
        self.assertFalse(allowed_feed_record({'hashtags':['#Suede', '#HeeledPump']}))
        self.assertFalse(allowed_feed_record({'hashtags':['#HeeledPump #Sneakers']}))

    def test_case_and_fullwidth_normalization(self):
        self.assertFalse(allowed_feed_record({'hashtags':['#heeledpump']}))
        self.assertFalse(allowed_feed_record({'hashtags':['＃ＨｅｅｌｅｄＰｕｍｐ']}))

    def test_new_catwalk_exclusions(self):
        for tag in ['#slingback', '#WedgeHeels', '#WEDGEHEELS']:
            self.assertFalse(allowed_feed_record({'hashtags':[tag]}))

    def test_other_footwear_is_preserved(self):
        self.assertTrue(allowed_feed_record({'hashtags':['#Sneakers','#HeeledSandal']}))

if __name__=='__main__':
    unittest.main()
