"""The colour a listing states, and the model two listings share because of it."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts' / 'monthly'))
from build_colour_words import derive  # noqa: E402
from footwear_scope import clean_colour_value, colour_from_style, is_opaque_codes  # noqa: E402
from model_grouping import (  # noqa: E402
    assign_model_groups, colour_from_remainder, is_colour_token, name_code, tokens)

NOTICE_29CM = '(입고 시기에 따라 정보가 상이할 수 있어, 수령하신 상품의 라벨을 참고하시기 바랍니다.)'
NOTICE_MUSINSA = '(선택되지 않는 색상은 판매하지 않거나 품절인 상품입니다)'


class ColourFieldTests(unittest.TestCase):
    def test_a_standing_notice_is_cut_and_the_colour_in_front_of_it_kept(self):
        self.assertEqual(clean_colour_value(f'아이보리 {NOTICE_MUSINSA}'), '아이보리')
        self.assertEqual(clean_colour_value(f'카멜 / 블랙 {NOTICE_MUSINSA}'), '카멜 / 블랙')

    def test_internal_colour_codes_are_not_a_colour(self):
        # 29CM answers the field with its own codes and then the notice. The
        # codes were reaching the chips as their label.
        self.assertEqual(clean_colour_value(f'BGD0,BLK0,WHGY {NOTICE_29CM}'), '')
        self.assertEqual(clean_colour_value('BLK0,DKBL,WHBR'), '')
        self.assertEqual(clean_colour_value('CHA0'), '')

    def test_a_list_of_real_colour_names_is_not_mistaken_for_codes(self):
        self.assertEqual(clean_colour_value('BLACK, WHITE'), 'BLACK, WHITE')
        self.assertFalse(is_opaque_codes('BLACK/WHITE'))

    def test_an_audience_tag_is_not_a_colour(self):
        self.assertEqual(clean_colour_value('맨발신발 [남성용]'), '')
        self.assertEqual(clean_colour_value('맨발신발 [여성용]'), '')

    def test_pointing_at_the_images_still_states_nothing(self):
        for value in ('상세내용참고', '설명페이지 참조', '상세피이지 참조', '없음', 'N/A', '-'):
            self.assertEqual(clean_colour_value(value), '', value)

    def test_a_retailers_own_code_is_stripped_off_the_colour_name(self):
        # 29CM pins a code to each name; it only stops that name matching the
        # same colour written plainly by another retailer.
        self.assertEqual(clean_colour_value('CHARCOAL(B02),DARK KHAKI(B65),DARK BEIGE(D18)'),
                         'CHARCOAL, DARK KHAKI, DARK BEIGE')
        self.assertEqual(clean_colour_value('(19)BLACK'), 'BLACK')
        self.assertEqual(clean_colour_value('BLACK(C01)'), 'BLACK')

    def test_a_parenthetical_that_is_not_a_code_is_left_alone(self):
        self.assertEqual(clean_colour_value('스무디 슬립온 (BLACK)'), '스무디 슬립온 (BLACK)')

    def test_a_colour_stated_in_the_style_field_is_not_thrown_away(self):
        # New Balance's Korean listings put the model code in the name and
        # the colour in the style field: name "NBPDGF762C", style
        # "MT10O6L5 (CHARCOAL)".
        self.assertEqual(colour_from_style('MT10O6L5 (CHARCOAL)'), 'CHARCOAL')
        self.assertEqual(colour_from_style('U204L6JO (BEIGE)'), 'BEIGE')
        self.assertEqual(colour_from_style('K3708240SD-W'), '')
        self.assertEqual(colour_from_style('ABC (123)'), '')

    def test_a_full_colourway_specification_survives_intact(self):
        # Nike states upper:midsole:outsole:accent. All of it is real.
        spec = '화이트:블리치트 라일락:서밋 화이트:메탈릭 실버'
        self.assertEqual(clean_colour_value(spec), spec)


class ColourVocabularyTests(unittest.TestCase):
    def test_boilerplate_is_never_learned_as_a_colour(self):
        values = [f'아이보리 {NOTICE_MUSINSA}'] * 3 + [f'블랙 {NOTICE_29CM}'] * 3
        learned = derive([v for v in map(clean_colour_value, values) if v])
        self.assertEqual(learned, ['블랙', '아이보리'])

    def test_codes_and_single_sightings_are_not_learned(self):
        self.assertNotIn('fw25', derive(['FW25', 'FW25']))
        self.assertNotIn('ur322ccr81', derive(['UR322CCR81', 'UR322CCR81']))
        self.assertNotIn('팔로미노', derive(['팔로미노']))          # seen once
        self.assertIn('팔로미노', derive(['팔로미노', '팔로미노']))


class ColourTokenTests(unittest.TestCase):
    def test_a_korean_compound_shade_is_recognised_inside_its_token(self):
        self.assertTrue(is_colour_token('실브라운'))
        self.assertTrue(is_colour_token('화이트아이보리'))

    def test_an_english_word_merely_containing_a_colour_is_not_one(self):
        # The substring rule used to apply to Latin too: "star" matched
        # "starter", "ink" matched "link", and unrelated models merged.
        for token in ('starter', 'link', 'instead', 'blacksmith'):
            self.assertFalse(is_colour_token(token), token)

    def test_a_silhouette_is_identity_not_colour(self):
        # 29CM writes GEOX's variants as "... 여성 스니커즈-그레이지" and
        # "... 여성 슬립온-골드". Both end in a shade, and a sneaker merged
        # with a slip-on onto one card.
        self.assertFalse(is_colour_token('스니커즈-그레이지'))
        self.assertFalse(is_colour_token('슬립온-골드'))
        self.assertFalse(is_colour_token('로퍼-블랙'))
        self.assertTrue(is_colour_token('그레이지'))

    def test_a_model_identifier_is_never_a_colour(self):
        for token in ('90', '95', 'v2', '1906', 'II'):
            self.assertFalse(is_colour_token(token), token)


class ModelGroupingTests(unittest.TestCase):
    @staticmethod
    def listings(*names, brand='BEARPAW'):
        return [{'id': f'i{n}', 'brand': brand, 'name': name} for n, name in enumerate(names)]

    def test_colours_written_into_the_name_become_one_model(self):
        items = self.listings(
            'OLLA 양털슬립온 실브라운 (K3708240SD-W)',
            'OLLA 양털슬립온 히커리 II (K3708220SD-W)',
            'OLLA 양털슬립온 초콜릿 (K3708205SD-W)',
            'OLLA 양털슬립온 블랙 II (K3708011SD-W)')
        assign_model_groups(items)
        self.assertEqual(len({i['modelGroupId'] for i in items}), 1)
        self.assertEqual([i['colorway'] for i in items],
                         ['실브라운', '히커리 II', '초콜릿', '블랙 II'])
        self.assertTrue(all(i['colorwayFrom'] == 'product-name' for i in items))

    def test_two_model_numbers_are_two_models(self):
        items = self.listings('Air Max 90', 'Air Max 95', brand='Nike')
        assign_model_groups(items)
        self.assertEqual([i.get('modelGroupId') for i in items], [None, None])

    def test_listings_differing_only_by_a_style_code_are_one_model(self):
        items = self.listings('[푸마 공식] H-Street OG (40369224)',
                              '[푸마 공식] H-Street OG (40369204)', brand='PUMA')
        assign_model_groups(items)
        self.assertEqual(len({i['modelGroupId'] for i in items}), 1)

    def test_a_declared_colour_is_never_overwritten(self):
        items = self.listings('헤리티지 로우 블랙 베이지', '헤리티지 로우 샌드 베이지', brand='JACLAR')
        items[0]['colorway'] = 'BLACK BEIGE'
        assign_model_groups(items)
        self.assertEqual(items[0]['colorway'], 'BLACK BEIGE')
        self.assertEqual(items[1]['colorway'], '샌드 베이지')

    def test_the_count_of_what_it_did_is_reported(self):
        items = self.listings('스무디 슬립온 (BLACK)', '스무디 슬립온 (WHITE)', brand='DISCOVERY')
        status = {}
        assign_model_groups(items, status)
        self.assertEqual(status['modelGroupsAssigned'], 2)
        self.assertEqual(status['colourwaysRecoveredFromName'], 2)

    def test_a_sneaker_and_a_slip_on_are_not_one_model(self):
        items = self.listings('제옥스 플렉스트라이드 플러스 여성 스니커즈-그레이지',
                              '제옥스 플렉스트라이드 플러스 여성 슬립온-골드', brand='GEOX')
        assign_model_groups(items)
        self.assertEqual([i.get('modelGroupId') for i in items], [None, None])

    def test_a_shared_style_code_stem_is_one_model_in_several_colours(self):
        # fitflop names two of these shades 카푸치노 and 스파이스드 에프리콧,
        # which are in no vocabulary. The code answers anyway.
        items = self.listings(
            '여성 네오D 하이커 패디드 트레이너  그레이 세이지 (FT69K2N51H)',
            '여성 네오D 하이커 패디드 트레이너  카푸치노 (FT69K2N51A)',
            '여성 네오D 하이커 패디드 트레이너  스파이스드 에프리콧 (FT69K2N517)',
            '여성 네오D 하이커 패디드 트레이너  블랙 (FT69K2N515)', brand='fitflop')
        status = {}
        assign_model_groups(items, status)
        self.assertEqual(len({i['modelGroupId'] for i in items}), 1)
        self.assertEqual(status['groupedByStyleCode'], 4)
        self.assertEqual([i['colorway'] for i in items],
                         ['그레이 세이지', '카푸치노', '스파이스드 에프리콧', '블랙'])
        self.assertEqual({i['modelName'] for i in items}, {'여성 네오D 하이커 패디드 트레이너'})

    def test_a_title_that_is_only_a_code_still_groups(self):
        items = self.listings('NBPDGF762C', 'NBPDGF762T', brand='New Balance')
        assign_model_groups(items)
        self.assertEqual(len({i['modelGroupId'] for i in items}), 1)

    def test_a_different_version_in_the_same_code_block_stays_apart(self):
        # fitflop numbers the metallic trainer alongside the plain one, so
        # they share FT69K2N51 while differing by a word in the middle.
        items = self.listings(
            '여성 네오D 하이커 패디드 트레이너  블랙 (FT69K2N515)',
            '여성 네오D 하이커 패디드 트레이너  카푸치노 (FT69K2N51A)',
            '여성 네오D 하이커 패디드 메탈릭 트레이너  실버 (FT69K2N512)', brand='fitflop')
        assign_model_groups(items)
        self.assertEqual(items[0]['modelGroupId'], items[1]['modelGroupId'])
        self.assertIsNone(items[2].get('modelGroupId'))

    def test_a_code_block_never_merges_two_model_numbers(self):
        items = self.listings('Air Max 90 DZ4504', 'Air Max 95 DZ4505', brand='Nike')
        assign_model_groups(items)
        self.assertEqual([i.get('modelGroupId') for i in items], [None, None])

    def test_a_colour_abbreviation_groups_like_the_word(self):
        items = self.listings('에버라스트 다이나믹 트레킹화 BLK',
                              '에버라스트 다이나믹 트레킹화 BRN',
                              '에버라스트 다이나믹 트레킹화 IVY', brand='everlast')
        assign_model_groups(items)
        self.assertEqual(len({i['modelGroupId'] for i in items}), 1)
        self.assertEqual([i['colorway'] for i in items], ['BLK', 'BRN', 'IVY'])

    def test_a_technology_suffix_is_not_a_colour_abbreviation(self):
        for token in ('GTX', 'DMX', 'ATR', 'OG', 'LS'):
            self.assertFalse(is_colour_token(token), token)

    def test_two_code_blocks_of_one_model_land_on_one_card(self):
        # adidas numbers the 핸드볼 스페지알 across unrelated code blocks.
        # The model's name is its identity; the code only finds it.
        items = self.listings('핸드볼 스페지알 IF6490', '핸드볼 스페지알 IF6562',
                              '핸드볼 스페지알 BD7632', brand='adidas')
        assign_model_groups(items)
        self.assertEqual(len({i['modelGroupId'] for i in items}), 1)

    def test_models_numbered_inside_one_code_block_stay_apart(self):
        # ASH numbers SIENA, SUPER and VIRGIN inside AG2D0100.
        items = self.listings(
            '[공식] ASH(아쉬) SIENA 시에나 스니커즈 (AG2D01005',
            '[공식] ASH(아쉬) SIENA 시에나 스니커즈 (AG2D01003',
            '[공식] ASH(아쉬) SUPER 수퍼 스니커즈 (AG2D01008',
            '[공식] ASH(아쉬) SUPER 수퍼 스니커즈 (AG2D01007', brand='ASH')
        assign_model_groups(items)
        self.assertEqual(items[0]['modelGroupId'], items[1]['modelGroupId'])
        self.assertEqual(items[2]['modelGroupId'], items[3]['modelGroupId'])
        self.assertNotEqual(items[0]['modelGroupId'], items[2]['modelGroupId'])

    def test_a_colour_after_an_underscore_is_still_a_colour(self):
        # NATIVE writes "제퍼슨_웨이브"; read as one token the colour is lost.
        self.assertEqual(tokens('[NATIVE] 네이티브 제퍼슨_화이트'),
                         ['[NATIVE]', '네이티브', '제퍼슨', '화이트'])
        items = self.listings('[NATIVE] 네이티브 제퍼슨_화이트',
                              '[NATIVE] 네이티브 제퍼슨_블랙', brand='NATIVE')
        assign_model_groups(items)
        self.assertEqual(len({i['modelGroupId'] for i in items}), 1)

    def test_one_odd_listing_no_longer_splits_the_whole_model(self):
        # "로 프로" is its own model and used to disqualify the prefix for
        # every colourway sharing it.
        items = self.listings('핸드볼 스페지알 IF6490', '핸드볼 스페지알 IF6562',
                              '핸드볼 스페지알 로 프로 KI2208', brand='adidas')
        assign_model_groups(items)
        self.assertEqual(items[0]['modelGroupId'], items[1]['modelGroupId'])
        self.assertIsNone(items[2].get('modelGroupId'))

    def test_a_word_is_never_mistaken_for_a_style_code(self):
        self.assertEqual(name_code({'name': 'Premium Skate SNEAKERS'}), '')
        self.assertEqual(name_code({'name': '핸드볼 스페지알 IF6490'}), 'IF6490')
        self.assertEqual(name_code({'name': '... 스니커즈 (AF2D01051'}), 'AF2D01051')

    def test_colour_is_read_out_of_a_bracketed_remainder(self):
        self.assertEqual(colour_from_remainder('(BLACK)'), 'BLACK')
        self.assertEqual(colour_from_remainder('히커리 II (K3708220SD-W)'), '히커리 II')


if __name__ == '__main__':
    unittest.main()
