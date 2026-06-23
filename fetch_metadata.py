import urllib.request
import xml.etree.ElementTree as ET

def find_properties():
    url = "https://graph.microsoft.com/beta/$metadata"
    req = urllib.request.Request(url)
    with urllib.request.urlopen(req) as response:
        xml_data = response.read()
    
    root = ET.fromstring(xml_data)
    ns = {'edmx': 'http://docs.oasis-open.org/odata/ns/edmx',
          'edm': 'http://docs.oasis-open.org/odata/ns/edm'}
    
    for schema in root.findall('.//edm:Schema', ns):
        if schema.attrib.get('Namespace') == 'microsoft.graph':
            for complex_type in schema.findall("edm:ComplexType[@Name='dataProcessorServiceForWindowsFeaturesOnboarding']", ns):
                print("dataProcessorServiceForWindowsFeaturesOnboarding properties:")
                for prop in complex_type.findall('edm:Property', ns):
                    print(f"  - {prop.attrib.get('Name')}")

if __name__ == "__main__":
    find_properties()
