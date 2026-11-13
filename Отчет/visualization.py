import numpy as np
import matplotlib.pyplot as plt
from mpl_toolkits.mplot3d.art3d import Poly3DCollection
from scipy.spatial import ConvexHull
import imageio
import open3d as o3d
import time
from collections import defaultdict, deque

def load_points(filename, step):
    data = np.loadtxt(filename)
    return data if step=='all' else data[::int(step)]

def build_faces(points):
    return ConvexHull(points).simplices

def repair_mesh(mesh):
    mesh.remove_unreferenced_vertices()
    mesh.remove_degenerate_triangles()
    mesh.remove_duplicated_triangles()
    mesh.remove_duplicated_vertices()
    mesh.remove_non_manifold_edges()
    return mesh

def simplify_mesh(points, faces, pct):
    verts = o3d.utility.Vector3dVector(points.astype(np.float64))
    tris = o3d.utility.Vector3iVector(faces.astype(np.int32))
    mesh = o3d.geometry.TriangleMesh(verts, tris)
    mesh.compute_vertex_normals()
    repair_mesh(mesh)
    target = max(4, int(len(mesh.triangles) * pct/100))
    dec = mesh.simplify_quadric_decimation(target_number_of_triangles=target)
    return np.asarray(dec.vertices), np.asarray(dec.triangles)

def surface_area(points, faces):
    tris = points[faces]
    v1 = tris[:,1] - tris[:,0]
    v2 = tris[:,2] - tris[:,0]
    return 0.5 * np.linalg.norm(np.cross(v1, v2), axis=1).sum()

def auto_pct(points, faces):
    mesh_orig = o3d.geometry.TriangleMesh(
        o3d.utility.Vector3dVector(points.astype(np.float64)),
        o3d.utility.Vector3iVector(faces.astype(np.int32))
    )
    mesh_orig.compute_vertex_normals()
    repair_mesh(mesh_orig)
    orig_area = mesh_orig.get_surface_area()
    rel_tol = 0.001
    low, high = 0.0, 100.0
    best = high
    iters = int(np.log2(len(faces))) + 2
    for _ in range(iters):
        mid = (low + high) / 2
        pts2, f2 = simplify_mesh(points, faces, mid)
        mesh2 = o3d.geometry.TriangleMesh(
            o3d.utility.Vector3dVector(pts2.astype(np.float64)),
            o3d.utility.Vector3iVector(f2.astype(np.int32))
        )
        mesh2.compute_vertex_normals()
        repair_mesh(mesh2)
        if mesh2.get_surface_area() / orig_area >= 1 - rel_tol:
            best = mid
            high = mid
        else:
            low = mid
    return best

def merge_coplanar_faces(points, faces, angle_tol_deg=1.0):
    normals = np.cross(points[faces][:,1] - points[faces][:,0],
                       points[faces][:,2] - points[faces][:,0])
    normals /= np.linalg.norm(normals, axis=1)[:,None]
    tol = np.cos(np.deg2rad(angle_tol_deg))
    edges = defaultdict(list)
    for i, f in enumerate(faces):
        for e in ((f[0],f[1]), (f[1],f[2]), (f[2],f[0])):
            edges[tuple(sorted(e))].append(i)
    adj = [[] for _ in faces]
    for nbrs in edges.values():
        if len(nbrs) == 2:
            a, b = nbrs
            if abs(normals[a].dot(normals[b])) >= tol:
                adj[a].append(b); adj[b].append(a)
    visited = [False] * len(faces)
    merged = []
    for i in range(len(faces)):
        if visited[i]: continue
        queue = deque([i]); visited[i] = True; group = [i]
        while queue:
            u = queue.popleft()
            for v in adj[u]:
                if not visited[v]:
                    visited[v] = True
                    queue.append(v)
                    group.append(v)
        verts = np.unique(points[np.concatenate(faces[group])], axis=0)
        ctr = verts.mean(axis=0)
        n = normals[group[0]]
        ref = np.array([1.0, 0, 0])
        if abs(n.dot(ref)) > 0.9: ref = np.array([0, 1.0, 0])
        u = np.cross(n, ref); u /= np.linalg.norm(u)
        v = np.cross(n, u)
        ang = np.arctan2((verts-ctr) @ v, (verts-ctr) @ u)
        merged.append(verts[np.argsort(ang)])
    return merged

def create_gif_rotating(points, faces, output, frames=60, color='lightgray'):
    xlims = (points[:,0].min(), points[:,0].max())
    ylims = (points[:,1].min(), points[:,1].max())
    zlims = (points[:,2].min(), points[:,2].max())
    fig = plt.figure(figsize=(6,6))
    ax = fig.add_subplot(111, projection='3d')
    ax.set_box_aspect([1,1,1])
    ax.set_xlim(*xlims); ax.set_ylim(*ylims); ax.set_zlim(*zlims)
    ax.set_xlabel('X'); ax.set_ylabel('Y'); ax.set_zlabel('Z'); ax.grid(True)
    coll = Poly3DCollection([points[f] for f in faces], facecolor=color, edgecolor='k', linewidth=0.5)
    ax.add_collection3d(coll)
    ax.plot([0,1],[0,0],[0,0], color='r')
    ax.plot([0,0],[0,1],[0,0], color='g')
    ax.plot([0,0],[0,0],[0,1], color='b')
    start = time.time()
    with imageio.get_writer(output, mode='I', fps=15) as writer:
        for i, angle in enumerate(np.linspace(0,360,frames, endpoint=False), start=1):
            ax.view_init(elev=20, azim=angle); fig.canvas.draw()
            w, h = fig.canvas.get_width_height()
            buf = np.frombuffer(fig.canvas.buffer_rgba(), dtype=np.uint8)
            img = buf.reshape(h, w, 4)[...,:3]; writer.append_data(img)
            elapsed = time.time() - start
            remaining = elapsed / i * (frames - i)
            print(f"\r{output}: {i}/{frames}, elapsed {elapsed:.1f}s, rem {remaining:.1f}s", end='')
    plt.close(fig); print(f"\nSaved {output}")

def create_gif_polygons(points, polygons, output, frames=60, color='lightgray'):
    xlims = (points[:,0].min(), points[:,0].max())
    ylims = (points[:,1].min(), points[:,1].max())
    zlims = (points[:,2].min(), points[:,2].max())
    fig = plt.figure(figsize=(6,6))
    ax = fig.add_subplot(111, projection='3d')
    ax.set_box_aspect([1,1,1])
    ax.set_xlim(*xlims); ax.set_ylim(*ylims); ax.set_zlim(*zlims)
    start = time.time()
    with imageio.get_writer(output, mode='I', fps=15) as writer:
        for i, angle in enumerate(np.linspace(0,360,frames, endpoint=False), start=1):
            ax.cla()
            ax.set_box_aspect([1,1,1])
            ax.set_xlim(*xlims); ax.set_ylim(*ylims); ax.set_zlim(*zlims)
            for poly in polygons:
                ax.add_collection3d(Poly3DCollection([poly], facecolor=color, edgecolor='k', linewidth=0.5))
            ax.view_init(elev=20, azim=angle); fig.canvas.draw()
            w, h = fig.canvas.get_width_height()
            buf = np.frombuffer(fig.canvas.buffer_rgba(), dtype=np.uint8)
            img = buf.reshape(h, w, 4)[...,:3]; writer.append_data(img)
            elapsed = time.time() - start
            remaining = elapsed / i * (frames - i)
            print(f"\r{output}: {i}/{frames}, elapsed {elapsed:.1f}s, rem {remaining:.1f}s", end='')
    plt.close(fig); print(f"\nSaved {output}")

def main():
    step = input("Enter sampling step or 'all': ").strip().lower()
    pts = load_points('output3D_r80.txt', step)
    faces = build_faces(pts)
    print(f"Original points: {len(pts)}, faces: {len(faces)}")
    create_gif_rotating(pts, faces, 'rotation.gif')
    count = int(input("How many simplified models to build? ").strip())
    for k in range(1, count+1):
        inp = input(f"Model {k}, enter pct or 'auto': ").strip().lower()
        pct = auto_pct(pts, faces) if inp=='auto' else float(inp)
        pts2, faces2 = simplify_mesh(pts, faces, pct)
        print(f"Model{k}: pts={len(pts2)}, faces={len(faces2)}, pct={pct:.2f}%")
        merged = merge_coplanar_faces(pts2, faces2)
        print(f"Model{k} merged faces: {len(merged)}")
        create_gif_polygons(pts2, merged, f'rotation_simplified_{k}.gif')
    print("Done.")

if __name__ == '__main__':
    main()
