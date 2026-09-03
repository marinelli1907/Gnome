#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKGROUND="$ROOT/artifacts/store/source/colorful-produce-border.png"
APPLE_SOURCE="$ROOT/artifacts/store/apple"
GOOGLE_SOURCE="$ROOT/artifacts/store/google"
APPLE_OUTPUT="$APPLE_SOURCE/color"
GOOGLE_OUTPUT="$GOOGLE_SOURCE/color"
APPROVED_LOGO="$ROOT/expo/assets/images/gnome-logo-full-hq.png"
SANS_FONT="/System/Library/Fonts/Supplemental/Arial.ttf"
SANS_BOLD_FONT="/System/Library/Fonts/Supplemental/Arial Bold.ttf"
DISPLAY_FONT="/System/Library/Fonts/Supplemental/Georgia Bold.ttf"

mkdir -p "$APPLE_OUTPUT" "$GOOGLE_OUTPUT"

labels=("DISCOVER" "MAP" "YOUR MARKET" "LIVE DROPS" "SEARCH" "LISTINGS" "ASK ZORDY" "SELL")
headlines=(
  "Fresh food, right around the corner."
  "Find local stands near you."
  "A farmers market that feels personal."
  "Know what is fresh before you go."
  "Find what you're craving."
  "Know exactly what is available."
  "Meet Zordy, your growing guide."
  "Turn what you grow into a local Market."
)
subheads=(
  "Browse real listings from nearby growers."
  "Map fresh food, free shares and local trades."
  "Follow sellers, see stand hours and request a visit."
  "Catch live drops and plan the perfect pickup."
  "Search and filter fresh local produce in seconds."
  "See price, quantity, seller and pickup details."
  "Get garden, listing and Market help in one place."
  "Add a photo, set the price and tell neighbors what is fresh."
)
colors=("#328736" "#1878CD" "#C2410C" "#8E44AD" "#8A5A00" "#C2410C" "#6B21A8" "#328736")
apple_inputs=("01-browse.jpg" "02-map.jpg" "03-market.jpg" "04-listing.jpg" "05-search.jpg" "06-listing-detail.jpg" "07-zordy.jpg" "08-sell.jpg")
google_inputs=("01-browse.png" "02-map.png" "03-market.png" "04-market-listings.png")

build_frame() {
  local input="$1"
  local output="$2"
  local width="$3"
  local height="$4"
  local phone_width="$5"
  local phone_height="$6"
  local phone_y="$7"
  local header_x="$8"
  local header_y="$9"
  local header_right="${10}"
  local header_bottom="${11}"
  local radius="${12}"
  local headline_size="${13}"
  local subhead_size="${14}"
  local label_size="${15}"
  local index="${16}"
  local tmp
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' RETURN

  magick "$BACKGROUND" -resize "${width}x${height}^" -gravity center -extent "${width}x${height}" "$tmp/background.png"
  magick "$input" -resize "${phone_width}x${phone_height}!" "$tmp/phone-flat.png"
  magick -size "${phone_width}x${phone_height}" xc:none -fill white \
    -draw "roundrectangle 0,0 $((phone_width - 1)),$((phone_height - 1)) ${radius},${radius}" "$tmp/mask.png"
  magick "$tmp/phone-flat.png" "$tmp/mask.png" -alpha off -compose CopyOpacity -composite "$tmp/phone.png"

  local phone_x=$(((width - phone_width) / 2))
  local shadow_x=$((phone_x - 18))
  local shadow_y=$((phone_y - 4))

  magick "$tmp/background.png" \
    -fill "${colors[$index]}" -stroke none \
    -draw "roundrectangle ${header_x},${header_y} ${header_right},${header_bottom} ${radius},${radius}" \
    -fill "rgba(0,0,0,0.22)" -draw "roundrectangle ${shadow_x},${shadow_y} $((phone_x + phone_width + 18)),$((phone_y + phone_height + 25)) ${radius},${radius}" \
    "$tmp/base.png"

  local text_width=$((header_right - header_x - 100))
  local label_y=$((header_y + 45))
  local headline_y=$((header_y + 112))
  local subhead_y=$((header_bottom - 100))

  magick -background none -fill white -font "$SANS_BOLD_FONT" -pointsize "$label_size" \
    -size "${text_width}x60" -gravity northwest "caption:${labels[$index]}" "$tmp/label.png"
  magick -background none -fill white -font "$DISPLAY_FONT" -pointsize "$headline_size" \
    -size "${text_width}x220" -gravity northwest "caption:${headlines[$index]}" "$tmp/headline.png"
  magick -background none -fill white -font "$SANS_FONT" -pointsize "$subhead_size" \
    -size "${text_width}x100" -gravity northwest "caption:${subheads[$index]}" "$tmp/subhead.png"

  magick "$tmp/base.png" \
    "$tmp/phone.png" -geometry "+${phone_x}+${phone_y}" -composite \
    "$tmp/label.png" -geometry "+$((header_x + 50))+${label_y}" -composite \
    "$tmp/headline.png" -geometry "+$((header_x + 50))+${headline_y}" -composite \
    "$tmp/subhead.png" -geometry "+$((header_x + 50))+${subhead_y}" -composite \
    -fill "#43B649" -stroke none -draw "roundrectangle $((width / 2 - 165)),$((height - 54)) $((width / 2 - 65)),$((height - 36)) 9,9" \
    -fill "#F4700A" -draw "roundrectangle $((width / 2 - 50)),$((height - 54)) $((width / 2 + 50)),$((height - 36)) 9,9" \
    -fill "#1E88E5" -draw "roundrectangle $((width / 2 + 65)),$((height - 54)) $((width / 2 + 165)),$((height - 36)) 9,9" \
    -alpha off -quality 96 \
    "$output"
}

for index in 0 1 2 3 4 5 6 7; do
  build_frame \
    "$APPLE_SOURCE/${apple_inputs[$index]}" \
    "$APPLE_OUTPUT/${apple_inputs[$index]}" \
    1320 2868 1030 2238 565 55 55 1265 535 46 84 34 30 "$index"
done

for index in 0 1 2 3; do
  build_frame \
    "$GOOGLE_SOURCE/${google_inputs[$index]}" \
    "$GOOGLE_OUTPUT/${google_inputs[$index]}" \
    1080 1920 810 1440 430 42 42 1038 405 36 66 29 24 "$index"
done

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
magick "$BACKGROUND" -resize "1024x500^" -gravity center -extent 1024x500 "$tmp/feature-background.png"
magick "$APPROVED_LOGO" -fuzz 4% -trim +repage -resize 800x390 "$tmp/feature-content.png"
magick "$tmp/feature-background.png" \
  -fill "rgba(0,0,0,0.20)" -stroke none -draw "roundrectangle 64,54 960,470 34,34" \
  -fill white -draw "roundrectangle 52,42 948,458 34,34" \
  "$tmp/feature-content.png" -gravity center -geometry +0-4 -composite \
  -fill "#43B649" -draw "roundrectangle 400,462 470,476 7,7" \
  -fill "#F4700A" -draw "roundrectangle 477,462 547,476 7,7" \
  -fill "#1E88E5" -draw "roundrectangle 554,462 624,476 7,7" \
  -alpha off -quality 96 "$GOOGLE_OUTPUT/feature-graphic-1024x500.png"

echo "Built eight Apple and four Google store gallery images."
