"""Charts from out/*.csv. Run: analysis\\agri\\.venv\\Scripts\\python.exe -I analysis\\agri_trend\\charts.py"""
from pathlib import Path
import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

HERE = Path(__file__).resolve().parent
OUT = HERE / "out"
INK, INK2, GRID, BG = "#0b0b0b", "#52514e", "#e4e3df", "#fcfcfb"
S1, S2, S3, S4 = "#2a78d6", "#eb6834", "#1baf7a", "#6250d6"
NAMES = {"Covered": "Whole covered area", "Southeast": "Southeast (wheat belt)", "Cukurova": "Çukurova",
         "Konya": "Konya plain", "AntMugla": "Antalya–Muğla coast", "Eskisehir": "Eskişehir"}
plt.rcParams.update({"font.size": 9, "axes.edgecolor": INK2, "axes.labelcolor": INK2, "xtick.color": INK2,
                     "ytick.color": INK2, "axes.facecolor": BG, "figure.facecolor": BG, "axes.grid": True,
                     "grid.color": GRID, "grid.linewidth": .6, "axes.spines.top": False, "axes.spines.right": False})

ann = pd.read_csv(OUT / "annual_series.csv").set_index(["region", "year"])
regs = list(NAMES)

# 1. annual cropland hotspots, three constructions, indexed to each series' own 2012-2025 mean
fig, axs = plt.subplots(len(regs), 1, figsize=(8, 2.1 * len(regs)), sharex=True)
for ax, r in zip(axs, regs):
    a = ann.loc[r]
    for col, c, lab, lw in (("harmonized", S1, "Harmonized (VIIRS-equivalent)", 2.2), ("modis_only", S2, "MODIS only", 1.6),
                            ("viirs_only", S3, "VIIRS only", 1.6)):
        s = a[col].dropna()
        s = s[s.index >= (2012 if col == "viirs_only" else 2003)]
        idx = 100 * s / s.loc[2012:2025].mean()
        ax.plot(idx.index, idx.values, color=c, lw=lw, marker="o", ms=3, label=lab)
    ax.axvspan(2020.5, 2025.5, color=GRID, alpha=.5, lw=0)
    ax.set_title(NAMES[r], loc="left", color=INK, fontsize=10)
    ax.set_ylabel("index\n(2012–25 = 100)")
axs[0].legend(loc="upper right", ncol=3, frameon=False, fontsize=8)
axs[-1].set_xlabel("Year   (shaded: 2021–25, MODIS orbit drift + S-NPP outages)")
fig.suptitle("Hotspots on cropland (ESA WorldCover 2021), per year", x=.02, ha="left", color=INK, fontsize=12)
fig.tight_layout()
fig.savefig(HERE / "fig1_cropland_annual.png", dpi=150)

# 2. forest-edge calendar: monthly share of edge cropland hotspots vs all cropland vs tree-cover fires
mt = pd.read_csv(OUT / "C_monthly_share.csv", header=[0, 1], index_col=0)
fig, axs = plt.subplots(2, 3, figsize=(11, 6), sharey=True)
axs = axs.ravel()
mon = "JFMAMJJASOND"
for ax, r in zip(axs, regs):
    for col, c, lab in (("crop_all", S2, "All cropland hotspots"), ("crop_edge20", S1, "Cropland ≤1 km from forest (tree ≥20%)"),
                        ("tree_fires", S3, "Tree-cover hotspots (forest fire)")):
        ax.plot(range(1, 13), mt[(r, col)].values, color=c, lw=2 if col == "crop_edge20" else 1.5, marker="o", ms=3, label=lab)
    ax.set_xticks(range(1, 13)); ax.set_xticklabels(list(mon))
    ax.set_title(NAMES[r], loc="left", color=INK, fontsize=10)
axs[0].set_ylabel("% of the group's hotspots, VIIRS 2012–25")
axs[0].legend(loc="upper left", frameon=False, fontsize=7)
fig.tight_layout()
fig.savefig(HERE / "fig2_forest_edge_calendar.png", dpi=150)

# 3. cropland vs tree-cover harmonized, whole covered area and Southeast
fig, axs = plt.subplots(1, 2, figsize=(10, 3.2))
for ax, r in zip(axs, ["Covered", "AntMugla"]):
    a = ann.loc[r]
    ax.bar(a.index - .2, a["harmonized"], width=.4, color=S2, label="Cropland")
    ax.bar(a.index + .2, a["tree_harmonized"], width=.4, color=S3, label="Tree cover")
    ax.set_title(NAMES[r] + " – harmonized hotspots per year", loc="left", color=INK, fontsize=10)
axs[0].legend(frameon=False)
fig.tight_layout()
fig.savefig(HERE / "fig3_crop_vs_forest_annual.png", dpi=150)
print("charts written")
