# Инвентарь эффектов (для переноса на WebGPU)

Сгенерировано `node dev/effects-inventory.mjs`. Не редактировать руками.

## Шейдеры (GLSL), строк

| Шейдер | Строк | Назначение |
|---|---:|---|
| common | 1132 | общий код: шум, смещения всех эффектов, зоны, руки, физика |
| vert | 1564 | вершинный шейдер точек (подключает common) |
| frag | 59 | фрагментный шейдер точек |
| lineVert | 1219 | вершинный шейдер линий «Связи» |
| lineFrag | 65 | фрагментный шейдер линий «Связи» |
| scopeVert | 1184 | вершинный шейдер линии «Осциллограф» |
| scopeFrag | 12 | фрагментный шейдер линии «Осциллограф» |

Значений кадра (uniform) всего: **115**; условий включения эффекта в шейдере: **46**.

## Эффекты

«Строк в vert» это размер защищённого блока шейдера, который работает только при включённом эффекте: грубая оценка веса эффекта при переносе. «Значения кадра» определены эвристически по `engine/loop.js` и могут быть неполными.

| Группа | Эффект (id) | Название | Строк в vert | Условия включения | Значения кадра (по loop.js) |
|---|---|---|---:|---|---|
| Видео | `frames` | Раскадровка |  |  |  |
| Фото и видео | `depth` | Объём по глубине |  |  |  |
| Анимация | `trail` | Шлейф |  |  |  |
| Движение | `curl` | Вихри и течение | 32 | `uCurl.x>0.001` `uCurlP.z>1.5` `uFlow.x>0.001` | `uCurl` `uCurlP` `uFlow` |
| Движение | `gravity` | Гравитация |  |  |  |
| Движение | `twist` | Деформация | 23 | `uTwist.x>0.001` | `uTwist` |
| Движение | `flow` | Течение | 7 | `uFlow.x>0.001` | `uFlow` |
| Движение | `jitter` | Дрожь | 3 | `uJitter.x>0.001` | `uJitter` |
| Звук и ритм | `spectrum` | Спектр | 14 | `uSpec.x>0.001` | `uSpec` `uSpecP` |
| Звук и ритм | `wave` | Волны | 24 | `uWave.x>0.001` | `uWave` |
| Звук и ритм | `blast` | Взрыв | 9 | `uBlast.x>0.001` | `uBlast` |
| Звук и ритм | `scope` | Осциллограф |  |  |  |
| Разрушение | `physics` | Распад |  |  |  |
| Разрушение | `explode` | Разбор на части |  |  |  |
| Разрушение | `dissolve` | Растворение |  | `uDisP.x>0.5` | `uDisP` |
| Цифровые | `voxel` | Воксели | 26 | `uVoxel.x>0.01` | `uShape` `uVoxel` `uVoxelP` |
| Цифровые | `glitch` | Глитч | 56 | `uGlitch.x>0.001` `uGlitchP.x>0.5` | `uGlitch` `uGlitchP` |
| Цифровые | `datamosh` | Датамош |  |  |  |
| Графика | `vscreen` | Экран |  |  |  |
| Графика | `links` | Связи |  |  | `uLink` `uLinkW` |
| Графика | `slice` | Срез |  |  |  |
| Графика | `feedback` | Следы времени |  |  |  |
| Графика | `echo` | Эхо |  |  |  |
| Графика | `tracking` | Рамки слежения |  |  |  |
| Управление | `cursor` | Курсор |  | `uCursor.z>1.5` | `uCursor` |
| Управление | `brush` | Кисть | 7 | `uPaintP.x>0.5` | `uPaintP` |
| Управление | `camTrack` | Руки (камера) |  |  |  |
| Эксперименты | `hyper` | Гиперпространство |  |  |  |

## Все условия включения в шейдере

| Условие | Строк в vert | в line | в scope |
|---|---:|---:|---:|
| `uBlast.x>0.001` | 9 | 9 | 9 |
| `uBrushParam.x>0.001` | 26 | 13 | 13 |
| `uContact.x>0.001` | 10 | 10 | 10 |
| `uContact.z>6.5` | 4 |  |  |
| `uCurl.x>0.001` | 25 | 25 | 25 |
| `uCurlP.z>1.5` |  |  |  |
| `uCursor.z>1.5` |  |  |  |
| `uDepth.x>0.001` | 26 | 1 | 1 |
| `uDepthP.w>1.5` |  |  |  |
| `uDisP.x>0.5` |  |  |  |
| `uDof.x>0.5` | 4 |  |  |
| `uExp.x>0.001` | 16 | 16 | 16 |
| `uFlow.x>0.001` | 7 | 7 | 7 |
| `uFr.x>0.5` | 100 | 6 | 6 |
| `uFr3.w>0.0001` | 6 | 6 | 6 |
| `uFr6.z>0.5` | 12 |  |  |
| `uGlitch.x>0.001` | 51 | 51 | 51 |
| `uGlitchP.x>0.5` | 5 | 5 | 5 |
| `uGrav.x>0.001` | 94 | 94 | 94 |
| `uGrowP.z>0.5` | 8 | 7 | 7 |
| `uHandP.x>0.001` | 33 | 24 | 24 |
| `uHyp.x>0.001` | 13 | 8 | 8 |
| `uJitter.x>0.001` | 3 | 3 | 3 |
| `uLinkP.x>1.5` |  | 1 |  |
| `uLinkP.y>0.5` |  |  |  |
| `uLinkP.z>0.5` |  | 4 |  |
| `uLookP2.x>0.001` | 3 |  |  |
| `uLookP2.y>0.001` | 4 |  |  |
| `uMark.x>3.5` | 5 | 5 | 5 |
| `uMask.w>0.5` | 1 | 1 | 1 |
| `uMask.x>0.5` | 18 | 17 | 17 |
| `uPaintP.x>0.5` | 7 |  |  |
| `uPhysics.x>0.001` | 58 | 58 | 58 |
| `uPulseP.x>0.5` | 12 | 12 | 12 |
| `uPulseP.x>1.5` | 5 | 5 | 5 |
| `uScope.x>0.001` | 22 |  |  |
| `uScr.x>0.001` | 37 |  |  |
| `uScr.y>2.5` | 4 |  |  |
| `uShockP.x>0.001` | 9 | 9 | 9 |
| `uSlice.x>0.001` | 16 |  |  |
| `uSliceM.x>0.5` | 1 | 1 | 1 |
| `uSliceM.x>1.5` |  |  |  |
| `uSpec.x>0.001` | 14 | 14 | 14 |
| `uTwist.x>0.001` | 23 | 23 | 23 |
| `uVoxel.x>0.01` | 26 | 26 | 26 |
| `uWave.x>0.001` | 24 | 24 | 24 |

## Значения кадра

`uTime`, `uMorph`, `uMorphS`, `uMorphO`, `uSettle`, `uFr`, `uFr2`, `uFr3`, `uFr4`, `uFr5`, `uHero`, `uFr6`, `uFr7`, `uHeroTex`, `uFrTex`, `uSize`, `uPR`, `uBeat`, `uColorBy`, `uBright`, `uGlow`, `uAdd`, `uDens`, `uP0`, `uP1`, `uP2`, `uYR`, `uShade`, `uGlyph`, `uAtlas`, `uMouse`, `uMouseOn`, `uSpecTex`, `uCurl`, `uSpec`, `uWave`, `uTwist`, `uPulse`, `uVoxel`, `uJitter`, `uCursor`, `uGlitch`, `uSlice`, `uSliceM`, `uSliceC`, `uMark`, `uMarkC`, `uLink`, `uLinkP`, `uContact`, `uShockP`, `uTrk`, `uImp`, `uShock`, `uMask`, `uMaskA`, `uMaskShow`, `uPhysics`, `uCollapseTime`, `uBrushHits`, `uBrushParam`, `uPaintP`, `uLookP2`, `uDof`, `uHyp`, `uHypP`, `uScr`, `uScrP`, `uScrTex`, `uScopeC`, `uScopeW`, `uScopeLB`, `uDepth`, `uDepthP`, `uDepthQ`, `uFlat`, `uScope`, `uScopeP`, `uScopeQ`, `uShape`, `uCurlP`, `uSpecP`, `uWaveP`, `uWaveSrc`, `uPulseP`, `uVoxelP`, `uGlitchP`, `uBlast`, `uFlow`, `uDisP`, `uSolid`, `uAtt`, `uHand`, `uHandP`, `uGrav`, `uGravT`, `uPhysP`, `uAsm`, `uDis`, `uDisT`, `uAnimN`, `uCen`, `uExp`, `uExpP`, `uPieceTex`, `uGrow`, `uGrowP`, `uGrowSeed`, `uJel`, `uJelO`, `uJelP`, `uDisQ`, `uGravP`, `uRes`, `uLinkW`

