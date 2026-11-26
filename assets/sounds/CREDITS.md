# Bruitages « GitHub » — provenance et licence

Tous les sons du jeu (`audio.js`) sont des fichiers audio **téléchargés depuis GitHub** :
les signaux sonores de l'éditeur **Visual Studio Code**, dépôt public
[`microsoft/vscode`](https://github.com/microsoft/vscode), dossier
[`src/vs/platform/accessibilitySignal/browser/media`](https://github.com/microsoft/vscode/tree/bd3842eb9529ca882b0b38b9e373d7e1a54d77a3/src/vs/platform/accessibilitySignal/browser/media).

- Commit source figé : `bd3842eb9529ca882b0b38b9e373d7e1a54d77a3`
- Licence : **MIT** (voir `LICENSE-vscode.txt`, copie du `LICENSE.txt` du dépôt)
- Aucune modification des fichiers : les mp3 sont les originaux, octet pour octet.
  Les fenêtres de lecture (`in`/`out` dans `audio.js`) sont appliquées à la lecture
  pour supprimer le silence de tête et la traîne muette, sans retoucher les fichiers.

Total : 23 fichiers  798 760 octets.

## Fichiers et usage dans le jeu

| Fichier | Durée lue | Usage dans Refs Cards | Source (commit figé) |
| --- | --- | --- | --- |
| `foldedAreas.mp3` | 0.27 s | tick (survol, petits clics), craquements de la découpe | [microsoft/vscode](https://github.com/microsoft/vscode/blob/bd3842eb9529ca882b0b38b9e373d7e1a54d77a3/src/vs/platform/accessibilitySignal/browser/media/foldedAreas.mp3) |
| `diffLineInserted.mp3` | 0.27 s | deal (carte distribuée), fin du jingle Pack Vidéo | [microsoft/vscode](https://github.com/microsoft/vscode/blob/bd3842eb9529ca882b0b38b9e373d7e1a54d77a3/src/vs/platform/accessibilitySignal/browser/media/diffLineInserted.mp3) |
| `diffLineModified.mp3` | 0.20 s | craquements pendant la découpe du booster | [microsoft/vscode](https://github.com/microsoft/vscode/blob/bd3842eb9529ca882b0b38b9e373d7e1a54d77a3/src/vs/platform/accessibilitySignal/browser/media/diffLineModified.mp3) |
| `diffLineDeleted.mp3` | 0.31 s | rip (déchirure finale) | [microsoft/vscode](https://github.com/microsoft/vscode/blob/bd3842eb9529ca882b0b38b9e373d7e1a54d77a3/src/vs/platform/accessibilitySignal/browser/media/diffLineDeleted.mp3) |
| `save.mp3` | 0.38 s | snap (carte rangée, boutons), caisse du cha-ching | [microsoft/vscode](https://github.com/microsoft/vscode/blob/bd3842eb9529ca882b0b38b9e373d7e1a54d77a3/src/vs/platform/accessibilitySignal/browser/media/save.mp3) |
| `requestSent.mp3` | 0.52 s | whoosh (carte qui file vers le butin) | [microsoft/vscode](https://github.com/microsoft/vscode/blob/bd3842eb9529ca882b0b38b9e373d7e1a54d77a3/src/vs/platform/accessibilitySignal/browser/media/requestSent.mp3) |
| `success.mp3` | 0.46 s | coin (pièces), jingles rare / classique, rareté Inhabituelle | [microsoft/vscode](https://github.com/microsoft/vscode/blob/bd3842eb9529ca882b0b38b9e373d7e1a54d77a3/src/vs/platform/accessibilitySignal/browser/media/success.mp3) |
| `terminalCommandSucceeded.mp3` | 0.41 s | coin (2e couche), rareté Commune | [microsoft/vscode](https://github.com/microsoft/vscode/blob/bd3842eb9529ca882b0b38b9e373d7e1a54d77a3/src/vs/platform/accessibilitySignal/browser/media/terminalCommandSucceeded.mp3) |
| `taskCompleted.mp3` | 1.01 s | cha-ching (achat), jingles légende / ultra, raretés Mythique et + | [microsoft/vscode](https://github.com/microsoft/vscode/blob/bd3842eb9529ca882b0b38b9e373d7e1a54d77a3/src/vs/platform/accessibilitySignal/browser/media/taskCompleted.mp3) |
| `confetti.mp3` | 1.09 s | pop (éclatement du booster), jingles, raretés hautes | [microsoft/vscode](https://github.com/microsoft/vscode/blob/bd3842eb9529ca882b0b38b9e373d7e1a54d77a3/src/vs/platform/accessibilitySignal/browser/media/confetti.mp3) |
| `clear.mp3` | 0.21 s | rip (balayage de la déchirure) | [microsoft/vscode](https://github.com/microsoft/vscode/blob/bd3842eb9529ca882b0b38b9e373d7e1a54d77a3/src/vs/platform/accessibilitySignal/browser/media/clear.mp3) |
| `editsKept.mp3` | 0.67 s | pop (2e couche), rareté Ultra épique | [microsoft/vscode](https://github.com/microsoft/vscode/blob/bd3842eb9529ca882b0b38b9e373d7e1a54d77a3/src/vs/platform/accessibilitySignal/browser/media/editsKept.mp3) |
| `progress.mp3` | 0.53 s | boucle de déchirement (tearStart/Update/Stop), montée des jingles légende / ultra | [microsoft/vscode](https://github.com/microsoft/vscode/blob/bd3842eb9529ca882b0b38b9e373d7e1a54d77a3/src/vs/platform/accessibilitySignal/browser/media/progress.mp3) |
| `codeActionTriggered.mp3` | 0.49 s | jingle du booster classique | [microsoft/vscode](https://github.com/microsoft/vscode/blob/bd3842eb9529ca882b0b38b9e373d7e1a54d77a3/src/vs/platform/accessibilitySignal/browser/media/codeActionTriggered.mp3) |
| `codeActionApplied.mp3` | 0.58 s | raretés Épique / Ultra épique / Divine et +, jingle ultra | [microsoft/vscode](https://github.com/microsoft/vscode/blob/bd3842eb9529ca882b0b38b9e373d7e1a54d77a3/src/vs/platform/accessibilitySignal/browser/media/codeActionApplied.mp3) |
| `quickFixes.mp3` | 0.37 s | jingle du booster rare, rareté Rare | [microsoft/vscode](https://github.com/microsoft/vscode/blob/bd3842eb9529ca882b0b38b9e373d7e1a54d77a3/src/vs/platform/accessibilitySignal/browser/media/quickFixes.mp3) |
| `responseReceived1.mp3` | 0.57 s | rareté Rare | [microsoft/vscode](https://github.com/microsoft/vscode/blob/bd3842eb9529ca882b0b38b9e373d7e1a54d77a3/src/vs/platform/accessibilitySignal/browser/media/responseReceived1.mp3) |
| `responseReceived2.mp3` | 0.47 s | rareté Super Rare, jingle du booster rare | [microsoft/vscode](https://github.com/microsoft/vscode/blob/bd3842eb9529ca882b0b38b9e373d7e1a54d77a3/src/vs/platform/accessibilitySignal/browser/media/responseReceived2.mp3) |
| `responseReceived3.mp3` | 0.47 s | rareté Épique, jingle du Pack Vidéo | [microsoft/vscode](https://github.com/microsoft/vscode/blob/bd3842eb9529ca882b0b38b9e373d7e1a54d77a3/src/vs/platform/accessibilitySignal/browser/media/responseReceived3.mp3) |
| `responseReceived4.mp3` | 0.46 s | raretés Légendaire et +, jingles légende / ultra | [microsoft/vscode](https://github.com/microsoft/vscode/blob/bd3842eb9529ca882b0b38b9e373d7e1a54d77a3/src/vs/platform/accessibilitySignal/browser/media/responseReceived4.mp3) |
| `voiceRecordingStarted.mp3` | 0.28 s | jingle du Pack Vidéo (bip d'enregistrement) | [microsoft/vscode](https://github.com/microsoft/vscode/blob/bd3842eb9529ca882b0b38b9e373d7e1a54d77a3/src/vs/platform/accessibilitySignal/browser/media/voiceRecordingStarted.mp3) |
| `terminalBell.mp3` | 0.43 s | jingle du Pack Vidéo, jingles légende / ultra, raretés Divine et + | [microsoft/vscode](https://github.com/microsoft/vscode/blob/bd3842eb9529ca882b0b38b9e373d7e1a54d77a3/src/vs/platform/accessibilitySignal/browser/media/terminalBell.mp3) |
| `chatUserActionRequired.mp3` | 0.45 s | montée des jingles légende et ultra | [microsoft/vscode](https://github.com/microsoft/vscode/blob/bd3842eb9529ca882b0b38b9e373d7e1a54d77a3/src/vs/platform/accessibilitySignal/browser/media/chatUserActionRequired.mp3) |

## Re-télécharger / mettre à jour

```bash
# un fichier, au commit figé ci-dessus
curl -L -H "Accept: application/vnd.github.raw" \
  "https://api.github.com/repos/microsoft/vscode/contents/src/vs/platform/accessibilitySignal/browser/media/save.mp3?ref=bd3842eb9529ca882b0b38b9e373d7e1a54d77a3" \
  -o assets/sounds/save.mp3
```

Si un cue est remplacé, re-mesurer sa fenêtre utile (`in`/`out`) et sa crête (`peak`)
puis mettre à jour la table `CUES` de `audio.js`, et incrémenter `SOUND_VERSION`.
