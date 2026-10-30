# -*- coding: utf-8 -*-
"""The three publication rules, on the listings that actually broke them."""
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'scripts', 'monthly')))

import dedupe_rules as D  # noqa: E402


def test_audience_reads_the_title_over_the_category():
    # 29CM files this one under a women's category; the title says 남성.
    assert D.audience({'name': '남성 RTG 레이스 업 트레이너 블랙', 'gender': 'women'}) == 'men'
    assert D.audience({'name': '[삼성물산공식] 여성 레트로Q FF 코드 트레이너', 'gender': 'men'}) == 'women'
    # "men" inside "women" must not win.
    assert D.audience({'name': 'Black Speedcat Go Womens Sneakers', 'gender': ''}) == 'women'
    assert D.audience({'name': "Men's Pace Sneaker", 'gender': ''}) == 'men'
    # No audience word anywhere: the shop's own category is all there is.
    assert D.audience({'name': '스무디 슬립온 (BLACK)', 'gender': 'women'}) == 'women'
    assert D.audience({'name': 'Tower Low Sneakers', 'gender': ''}) == ''


def test_same_design_publishes_as_the_womens_listing():
    items = [
        {'id': 'm1', 'brand': 'jaclar', 'name': '남성 페이스 로우 차콜 그레이', 'gender': 'men',
         'modelGroupId': 'g1', 'photoHash': 'aaaaaaaaaaaaaaaa', 'colorway': 'charcoal',
         'source': 'retail-29cm', 'url': 'https://29cm/m1'},
        {'id': 'w1', 'brand': 'jaclar', 'name': '여성 페이스 로우 차콜 그레이', 'gender': 'women',
         'modelGroupId': 'g1', 'photoHash': 'aaaaaaaaaaaaaaaa', 'colorway': 'charcoal',
         'source': 'retail-29cm', 'url': 'https://29cm/w1'},
    ]
    status = {}
    kept = D.prefer_women(items, status)
    assert [i['id'] for i in kept] == ['w1']
    assert status['mensDuplicatesDropped'] == 1
    # The men's listing is recorded on the survivor, not lost.
    assert kept[0]['alsoListedAt'][0]['url'] == 'https://29cm/m1'


def test_a_mens_only_design_is_left_alone():
    items = [
        {'id': 'm1', 'brand': 'Nike', 'name': "Men's Pace Sneaker", 'gender': 'men',
         'modelGroupId': 'g1', 'photoHash': 'bbbbbbbbbbbbbbbb', 'colorway': 'black'},
    ]
    assert len(D.prefer_women(items, {})) == 1


def test_two_models_in_one_group_do_not_merge_across_designs():
    # Same card, different designs: the women's Gimli must not retire the
    # men's Aragon just because both sit in one model group.
    items = [
        {'id': 'm1', 'brand': 'PANE', 'name': "Men's Nogi Shoes Aragon", 'gender': 'men',
         'modelGroupId': 'g1', 'photoHash': '1111111111111111', 'colorway': 'aragon'},
        {'id': 'w1', 'brand': 'PANE', 'name': "Women's Nogi Shoes Gimli", 'gender': 'women',
         'modelGroupId': 'g1', 'photoHash': '2222222222222222', 'colorway': 'gimli'},
    ]
    assert len(D.prefer_women(items, {})) == 2


def test_retail_copy_of_an_official_product_is_dropped():
    official = {'products': [
        {'brand': 'Nike', 'name': 'Pegasus Plus 2', 'style': 'IM2541-400'},
        {'brand': 'Balenciaga', 'name': "Women's Pace Sneaker in Black", 'style': 'A004VIWASYM1000'},
    ]}
    keys = D._identity_keys('Nike', 'Pegasus Plus 2', 'IM2541-400')
    assert f'nike|pegasusplus2' in keys
    official_keys = set()
    for p in official['products']:
        official_keys.update(D._identity_keys(p['brand'], p['name'], p['style']))
    items = [
        {'id': 'r1', 'brand': 'Nike', 'name': 'Pegasus Plus 2', 'style': ''},
        {'id': 'r2', 'brand': 'Balenciaga', 'name': 'Pace Sneaker', 'style': 'A004VIWASYM1000'},
        {'id': 'r3', 'brand': 'Veja', 'name': 'GT Sneakers', 'style': ''},
    ]
    status = {}
    kept = D.drop_already_official(items, official_keys, status)
    assert [i['id'] for i in kept] == ['r3']
    assert status['alreadyOfficialDropped'] == 2


def test_a_colour_word_in_the_style_field_is_not_a_style_code():
    # 29CM files KEEN's 재스퍼 under "BLACK"; matching on it would retire
    # every black shoe the brand makes.
    assert D._identity_keys('KEEN', '재스퍼 여성 스니커즈', 'BLACK') == ['keen|재스퍼스니커즈']
    assert any(k.startswith('style:') for k in D._identity_keys('Nike', 'Air Max', 'IM2541400'))


def test_evergreen_lines_never_count_as_new():
    keys = D.evergreen_keys()
    assert D.is_evergreen({'brand': 'Balenciaga', 'name': 'Speed 2 0 Sneakers',
                           'fullName': '발렌시아가 "스피드 2.0" 스니커즈', 'style': '392159_1108'}, keys)
    assert D.is_evergreen({'brand': 'Balenciaga', 'name': 'Triple S.2 Sneaker in Black'}, keys)
    assert D.is_evergreen({'brand': 'adidas', 'name': '가젤 로우 프로 KI4709'}, keys)
    assert D.is_evergreen({'brand': 'New Balance', 'name': '530 White'}, keys)
    assert D.is_evergreen({'brand': 'Nike', 'name': "Nike Air Max Plus 'Check'"}, keys)
    assert D.is_evergreen({'brand': 'Autry', 'name': 'Medialist Low Sneakers'}, keys)


def test_evergreen_matching_stays_on_word_boundaries():
    keys = D.evergreen_keys()
    # 1530 is not the 530, and the Speedcat relaunch is deliberately unlisted.
    assert not D.is_evergreen({'brand': 'New Balance', 'name': '1530 Trail'}, keys)
    assert not D.is_evergreen({'brand': 'PUMA', 'name': 'Speedcat OG II'}, keys)
    assert not D.is_evergreen({'brand': 'PUMA', 'name': 'Speedcat Croc Sneakers'}, keys)
    assert not D.is_evergreen({'brand': 'Nike', 'name': 'Pegasus Plus 2'}, keys)
    assert not D.is_evergreen({'brand': 'Veja', 'name': 'GT Sneakers'}, keys)


if __name__ == '__main__':
    failures = 0
    for name, fn in sorted(globals().items()):
        if not name.startswith('test_') or not callable(fn):
            continue
        try:
            fn()
            print('ok   ' + name)
        except AssertionError as e:
            failures += 1
            print('FAIL ' + name + '  ' + str(e))
    print(('all passed' if not failures else f'{failures} failed'))
    sys.exit(1 if failures else 0)
