# Contexte de l'environnement

## Type d'environnement

Ceci est un **VPS (Virtual Private Server)** de production/développement.
Toutes les opérations s'exécutent en tant que `root` sur cette machine.

## Informations serveur

- **Hostname** : srv1309636
- **OS** : Debian 13 (trixie) - version 13.2
- **Kernel** : Linux 6.12.57+deb13-amd64 (x86_64)
- **CPU** : 2 vCPUs
- **RAM** : 7.8 Go
- **Disque** : 99 Go (SSD)
- **IP publique** : 72.62.237.177
- **Utilisateur** : root

## Outils disponibles

- **Python** : 3.13.5
- **Git** : 2.47.3
- **Docker** : 29.2.0

## Conventions

- Le répertoire de travail principal est `/root/project/`.
- On travaille directement sur le VPS, pas en local.
- Les services peuvent être exposés sur l'IP publique — faire attention aux ports ouverts et à la sécurité.
- Toujours utiliser Docker quand c'est pertinent pour isoler les services.
- Ne jamais stocker de secrets (clés API, mots de passe) en clair dans les fichiers du projet. Utiliser des variables d'environnement ou un fichier `.env` (ajouté au `.gitignore`).

## Structure du projet

```
project/
├── CLAUDE.md          # Ce fichier — contexte pour Claude
└── ...                # Les fichiers du projet seront ajoutés ici
```
