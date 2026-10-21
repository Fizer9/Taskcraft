#!/usr/bin/env python3
"""
Звуки WC3 для сайта: перекодирует нужные .flac из выгрузки в небольшие .mp3 в assets-src/sound/
(оттуда их шифрует encrypt-assets, как модели). Голоса юнитов берёт из _locales/<язык>.w3mod
и кладёт в assets-src/sound/voice/, голосовые предупреждения в sound/warning/, отклик зданий
в sound/buildings/. Нужен ffmpeg.

    python scripts/build-sound.py --root work/war3.w3mod --lang ruru
"""

import argparse
import os
import subprocess
import sys

# имя в игре → путь внутри _de.w3mod
SFX = {
    'click': 'sound/interface/mouseclick1',
    'error': 'sound/interface/error',
    'gold': 'sound/interface/itemreceived',
    'goodjob': 'sound/interface/goodjob',
    'quest': 'ui/feedback/checkpointpopup/questcheckpoint',
    'hit': 'sound/units/combat/metalmediumslicemetal1',
    'bash': 'sound/units/combat/metalheavybashstone1',
    'gatefall': 'sound/buildings/death/undeadbuildingdeathlarge1',
    'build': 'sound/buildings/shared/buildingconstruction',
    'rooster': 'sound/time/daybreakrooster',
    'wolf': 'sound/time/duskwolf',
    'victory': 'sound/music/mp3music/humanvictory',
    'hover': 'sound/interface/mouseover1',
    'hint': 'sound/interface/hint',
    'goldlow': 'sound/interface/goldminerunningout1',
    'bigclick': 'sound/interface/bigbuttonclick',
    'bling': 'sound/interface/waypointbling',
    'item': 'sound/interface/herodropitem1',
    'collapse': 'sound/buildings/death/buildingdeathlargehuman',
    'collapse-small': 'sound/buildings/death/buildingdeathsmallhuman',
    'place': 'sound/buildings/shared/buildingplacement',
    'hammer': 'sound/buildings/shared/constructionloop1',
    # предсмертный крик юнита, который разлетается на куски
    'explode': 'units/human/footman/footmandeath_hd',
}
# Фон окружения: день и ночь Лордерона летом, дождь, мельница и ручей у баз.
AMBIENT = {
    'amb-day': 'sound/ambient/lordaeronsummer/lordaeronsummerday',
    'amb-night': 'sound/ambient/lordaeronsummer/lordaeronsummernight',
    'amb-rain': 'sound/ambient/rainambience',
    'amb-windmill': 'sound/ambient/doodadeffects/lordaeronsummerwindmillloop1',
    'amb-stream': 'sound/ambient/doodadeffects/waterstreamloop/waterstreamloop1',
}
MUSIC = {
    'human1': 'sound/music/mp3music/human1',
    'human2': 'sound/music/mp3music/human2',
    'human3': 'sound/music/mp3music/human3',
}

# Отклик зданий на щелчок: имя в игре → путь в корне выгрузки (классические .ogg, их нет в _de.w3mod).
BUILDINGS = {
    'townhall': 'buildings/human/townhall/townhallwhat1',
    'keep': 'buildings/human/townhall/keepwhat1',
    'castle': 'buildings/human/townhall/castlewhat1',
    'farm': 'buildings/human/farm/farmwhat1',
    'barracks': 'buildings/human/humanbarracks/humanbarrackswhat1',
    'altar': 'buildings/human/altarofkings/altarofkingswhat1',
    'lumbermill': 'buildings/human/humanlumbermill/humanlumbermillwhat1',
    'blacksmith': 'buildings/human/blacksmith/blacksmithwhat1',
    'workshop': 'buildings/human/workshop/workshopwhat1',
    'towers': 'buildings/human/humantower/guardtowerwhat1',
    'aviary': 'buildings/human/gryphonaviary/gryphonaviarywhat1',
    'vault': 'buildings/human/arcanevault/arcanevaultwhat1',
}
# Голосовые предупреждения людей (_locales/<язык>.w3mod/sound/interface/warning/human).
WARNINGS = {
    'nogold': 'knightnogold1',
    'nolumber': 'knightnolumber1',
    'nofood': 'knightnofood1',
    'goldminelow': 'knightgoldminelow1',
    'townattack': 'knighttownattack1',
    'herodies': 'knightherodies1',
    # «Работа завершена»: в выгрузку пока не попал
    'jobdone': 'peasantbuildingcomplete1',
}

# юниты, чьи голоса нужны игре (папки в _locales/<язык>.w3mod/units/human)
VOICES = ['peasant', 'footman', 'rifleman', 'knight', 'gryphonrider', 'heromountainking']
# какие реплики: готов, да, в атаку, что, клич и «надоел» после частых кликов
VOICE_KINDS = ('ready', 'yesattack', 'yes', 'what', 'warcry', 'pissed')


def convert(src, dst, bitrate, mono):
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    cmd = ['ffmpeg', '-y', '-loglevel', 'error', '-i', src, '-codec:a', 'libmp3lame', '-b:a', bitrate]
    if mono:
        cmd += ['-ac', '1']
    subprocess.run(cmd + [dst], check=True)
    print('  %s %d КБ' % (dst, os.path.getsize(dst) // 1024))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--root', default='work/war3.w3mod')
    ap.add_argument('--out', default='assets-src')
    ap.add_argument('--lang', default='ruru', help='папка языка голосов: ruru, enus и т.д.')
    args = ap.parse_args()
    missing = []
    for table, bitrate, mono in ((SFX, '96k', True), (MUSIC, '112k', False), (AMBIENT, '48k', True)):
        for name, rel in table.items():
            src = os.path.join(args.root, '_de.w3mod', rel + '.flac')
            if not os.path.exists(src):
                missing.append(rel)
                continue
            convert(src, os.path.join(args.out, 'sound', name + '.mp3'), bitrate, mono)
    for name, rel in BUILDINGS.items():
        src = os.path.join(args.root, rel + '.ogg')
        if not os.path.exists(src):
            missing.append(rel)
            continue
        convert(src, os.path.join(args.out, 'sound', 'buildings', name + 'what.mp3'), '64k', True)
    warnings = os.path.join(args.root, '_locales', args.lang + '.w3mod', 'sound', 'interface', 'warning', 'human')
    for name, file in WARNINGS.items():
        src = os.path.join(warnings, file + '.ogg')
        if not os.path.exists(src):
            missing.append(os.path.join('_locales', args.lang + '.w3mod', 'sound', 'interface', 'warning', 'human', file))
            continue
        convert(src, os.path.join(args.out, 'sound', 'warning', name + '.mp3'), '64k', True)
    voices = os.path.join(args.root, '_locales', args.lang + '.w3mod', 'units', 'human')
    for unit in VOICES:
        folder = os.path.join(voices, unit)
        if not os.path.isdir(folder):
            missing.append(os.path.join('_locales', args.lang + '.w3mod', 'units', 'human', unit))
            continue
        for f in sorted(os.listdir(folder)):
            name, ext = os.path.splitext(f)
            kind = name[len(unit):].rstrip('0123456789')
            if ext in ('.ogg', '.flac', '.wav') and name.startswith(unit) and kind in VOICE_KINDS:
                convert(os.path.join(folder, f), os.path.join(args.out, 'sound', 'voice', name + '.mp3'), '48k', True)
    if missing:
        print('Нет файлов (пропущены): ' + ', '.join(missing), file=sys.stderr)


if __name__ == '__main__':
    main()
