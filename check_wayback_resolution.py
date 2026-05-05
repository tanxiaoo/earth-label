import csv
import json
import sys
import time
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import datetime, timezone

def fetch_wayback_metadata(lat, lon):
    url = "https://metadata.maptiles.arcgis.com/arcgis/rest/services/World_Imagery_Metadata_2024_r13/MapServer/identify"
    params = {
        "geometry": f"{lon},{lat}",
        "geometryType": "esriGeometryPoint",
        "tolerance": "2",
        "mapExtent": f"{lon-0.0005},{lat-0.0005},{lon+0.0005},{lat+0.0005}",
        "imageDisplay": "1024,1024,96",
        "layers": "all",
        "returnGeometry": "false",
        "f": "json"
    }
    
    query_string = urllib.parse.urlencode(params)
    full_url = f"{url}?{query_string}"
    
    try:
        req = urllib.request.Request(full_url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=10) as response:
            data = json.loads(response.read().decode())
            return data.get("results", [])
    except Exception as e:
        print(f"Error fetching data for {lat},{lon}: {e}", file=sys.stderr)
        return []

def format_date(epoch_ms):
    if not epoch_ms or epoch_ms == 'Null':
        return None
    try:
        # Convert ms to seconds
        dt = datetime.fromtimestamp(int(epoch_ms) / 1000.0, tz=timezone.utc)
        return dt.strftime('%Y-%m-%d')
    except (ValueError, TypeError):
        return None

def main():
    if len(sys.argv) < 2:
        print("Usage: python check_wayback_resolution.py <input_csv>")
        sys.exit(1)
        
    input_file = sys.argv[1]
    output_file = 'wayback_resolution_results.csv'
    
    # Statistics variables
    stats = {
        'total': 0,
        'high_res': 0,    # < 1m
        'medium_res': 0,  # 1-5m
        'low_res': 0,     # 5-15m
        'fallback': 0,    # >= 15m or no data
        'year_2024': 0,
        'year_2023': 0,
        'year_older_null': 0
    }
    res_breakdown = defaultdict(int)
    provider_breakdown = defaultdict(int)
    
    try:
        with open(input_file, mode='r', encoding='utf-8') as infile:
            reader = csv.DictReader(infile)
            fieldnames = [f for f in reader.fieldnames]
            
            # Add output columns if they don't exist
            new_columns = ['best_resolution_m', 'capture_date', 'provider', 'metadata_layer']
            out_fieldnames = fieldnames + new_columns
            
            rows = list(reader)
            total_rows = len(rows)
            
    except FileNotFoundError:
        print(f"Error: File '{input_file}' not found.")
        sys.exit(1)

    with open(output_file, mode='w', encoding='utf-8', newline='') as outfile:
        writer = csv.DictWriter(outfile, fieldnames=out_fieldnames)
        writer.writeheader()
        
        print(f"Processing {total_rows} points...")
        
        for i, row in enumerate(rows, 1):
            try:
                lat = float(row['LAT'])
                lon = float(row['LON'])
            except (ValueError, KeyError):
                print(f"Warning: Invalid LAT/LON at row {i}")
                continue
                
            results = fetch_wayback_metadata(lat, lon)
            
            best_res = None
            best_attr = None
            best_layer = None
            
            for res in results:
                attr = res.get('attributes', {})
                src_res = attr.get('SRC_RES')
                if src_res and src_res != 'Null':
                    try:
                        res_val = float(src_res)
                        if best_res is None or res_val < best_res:
                            best_res = res_val
                            best_attr = attr
                            best_layer = res.get('layerName', '')
                    except ValueError:
                        pass
                        
            # Extract data for the best result
            capture_date = ''
            provider = ''
            resolution = ''
            capture_year = None
            
            if best_res is not None:
                resolution = best_res
                provider = best_attr.get('NICE_NAME', '')
                raw_date = best_attr.get('SRC_DATE2')
                capture_date = format_date(raw_date) or ''
                
                # Update stats
                stats['total'] += 1
                if resolution < 1.0:
                    stats['high_res'] += 1
                elif 1.0 <= resolution < 5.0:
                    stats['medium_res'] += 1
                elif 5.0 <= resolution < 15.0:
                    stats['low_res'] += 1
                else:
                    stats['fallback'] += 1
                    
                res_breakdown[resolution] += 1
                if provider:
                    provider_breakdown[provider] += 1
                    
                if capture_date:
                    capture_year = capture_date[:4]
                    if capture_year == '2024':
                        stats['year_2024'] += 1
                    elif capture_year == '2023':
                        stats['year_2023'] += 1
                    else:
                        stats['year_older_null'] += 1
                else:
                    stats['year_older_null'] += 1
            else:
                stats['total'] += 1
                stats['fallback'] += 1
                stats['year_older_null'] += 1
                
            # Write to CSV
            row['best_resolution_m'] = resolution
            row['capture_date'] = capture_date
            row['provider'] = provider
            row['metadata_layer'] = best_layer or ''
            writer.writerow(row)
            
            # Progress print
            if i % 10 == 0 or i == total_rows:
                print(f"Processed {i}/{total_rows} points...")
                
            time.sleep(0.2) # Rate limiting
            
    # Print Statistics Summary
    total = stats['total']
    if total == 0:
        print("No points processed.")
        sys.exit(0)
        
    def pct(count):
        return f"{(count/total)*100:.1f}%"
        
    print("\n=== ESRI Wayback Resolution Statistics ===")
    print(f"Total points: {total}")
    print(f"Points with high-res (<1m): {stats['high_res']} ({pct(stats['high_res'])})")
    print(f"Points with medium-res (1-5m): {stats['medium_res']} ({pct(stats['medium_res'])})")
    print(f"Points with low-res (5-15m): {stats['low_res']} ({pct(stats['low_res'])})")
    print(f"Points with no data / 15m fallback: {stats['fallback']} ({pct(stats['fallback'])})\n")
    
    print(f"Points with 2024 capture date: {stats['year_2024']} ({pct(stats['year_2024'])})")
    print(f"Points with 2023 capture date: {stats['year_2023']} ({pct(stats['year_2023'])})")
    print(f"Points with older/null date: {stats['year_older_null']} ({pct(stats['year_older_null'])})\n")
    
    print("Resolution breakdown:")
    for res in sorted(res_breakdown.keys()):
        print(f"  {res}m: {res_breakdown[res]} points")
        
    print("\nProvider breakdown:")
    # Sort providers by count descending
    sorted_providers = sorted(provider_breakdown.items(), key=lambda x: x[1], reverse=True)
    for prov, count in sorted_providers:
        print(f"  {prov}: {count} points")
    print()

if __name__ == "__main__":
    main()
